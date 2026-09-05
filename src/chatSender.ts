import Main from './main';
import promiseTry from './shared/tools/promiseTry';
import ErrorWithCode from './shared/tools/errorWithCode';
import {getStreamAsCaption, getStreamAsDescription} from './tools/streamToString';
import inlineInspect from './tools/inlineInspect';
import fetchRequest from './tools/fetchRequest';
import {ChatModel, MessageModelWithStreamId, StreamModelWithChannel} from './db';
import {getDebug} from './shared/tools/getDebug';
import {type Message} from 'node-telegram-bot-api';
import {tracker} from './tracker';
import {
  ErrEnum,
  errHandler,
  getTelegramErrorBody,
  isBlockedError,
  isSkipMessageError,
  passEx,
} from './shared/tools/passTgEx';
import NodeReadableStream = NodeJS.ReadableStream;
import {coordinatePreviewRequest, sendPreviewPhoto} from './shared/tools/telegramPreview';

const debug = getDebug('app:ChatSender');

interface SentMessage {
  type: string;
  text: string;
  message: Message;
}

class ChatSender {
  private streamIds: string[] | null;
  private messages: MessageModelWithStreamId[] | null;
  private readonly methods: string[];
  private methodIndex: number;
  aborted = false;
  lockCount = 0;
  startAt: number;
  lastActivityAt: number;
  constructor(
    private main: Main,
    public chat: ChatModel,
  ) {
    this.startAt = Date.now();
    this.lastActivityAt = Date.now();

    this.methodIndex = 0;
    this.methods = ['send', 'update', 'delete'];

    this.streamIds = null;
    this.messages = null;
  }

  getStreamIds() {
    return this.main.db.getStreamIdsByChatId(this.chat.id, 10);
  }

  getMessages() {
    return this.main.db.getMessagesByChatId(this.chat.id, 10);
  }

  getDeleteMessages() {
    return this.main.db.getMessagesForDeleteByChatId(this.chat.id, 1);
  }

  async next() {
    let skipFromIndex: number | null = null;
    let startIndex = this.methodIndex;
    while (true) {
      if (this.aborted) return;
      this.lastActivityAt = Date.now();
      const isDone = await promiseTry(() => {
        if (skipFromIndex !== null && this.methodIndex >= skipFromIndex) return true;

        switch (this.methods[this.methodIndex]) {
          case 'send': {
            return this.send();
          }
          case 'update': {
            return this.update();
          }
          case 'delete': {
            return this.delete();
          }
        }
      });
      if (!isDone) return;
      this.methodIndex++;
      if (this.methods.length === this.methodIndex) {
        this.methodIndex = 0;
        if (startIndex !== 0) {
          skipFromIndex = startIndex;
          startIndex = 0;
        } else {
          return true;
        }
      }
    }
  }

  async send() {
    if (!this.streamIds || !this.streamIds.length) {
      this.streamIds = await this.getStreamIds();
    }

    const streamId = this.streamIds.shift();
    if (!streamId) {
      return true;
    }

    try {
      await this.main.sender.provideStream(streamId, (stream) => {
        return this.sendStream(stream);
      });
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'STREAM_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }
  }

  async update() {
    if (!this.messages || !this.messages.length) {
      this.messages = await this.getMessages();
    }

    const message = this.messages.shift();
    if (!message) {
      return true;
    }

    try {
      await this.main.sender.provideStream(message.streamId, async (stream) => {
        let text: string;
        if (message.type === 'text') {
          text = getStreamAsDescription(stream, this.main.getServiceById(stream.channel.service)!);
        } else {
          text = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);
        }

        try {
          if (message.text !== text) {
            await passEx(
              () =>
                this.updateStreamMessage(
                  message.type,
                  message.chatId,
                  Number(message.id),
                  stream,
                  text,
                ),
              [ErrEnum.MessageNotModified],
            );
          }
        } catch (error) {
          const err = error as Error;
          if (
            errHandler[ErrEnum.MessageToEditNotFound](err) ||
            errHandler[ErrEnum.MessageCantBeEdited](err)
          ) {
            await this.main.db.deleteMessageById(message._id);
          } else {
            await this.onSendMessageError(err);
          }
          return;
        }

        await message.update({
          text,
          hasChanges: false,
        });
      });
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'STREAM_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }
  }

  async delete() {
    const messages = await this.getDeleteMessages();

    if (!messages.length) {
      return true;
    }

    const message = messages.shift();
    if (!message) {
      return true;
    }

    const minDeleteTime = new Date();
    minDeleteTime.setHours(minDeleteTime.getHours() - 48);

    await promiseTry(async () => {
      try {
        if (this.chat.isEnabledAutoClean && message.createdAt.getTime() > minDeleteTime.getTime()) {
          await this.deleteStreamMessage(message.chatId, Number(message.id));
        }
      } catch (error) {
        const body = getTelegramErrorBody(error);
        if (body) {
          const isSkipError = [
            /message to delete not found/,
            /message can't be deleted/,
            /group chat was upgraded/,
          ].some((re) => re.test(body.description));

          if (isSkipError) {
            // pass
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }).then(() => {
      return this.main.db.deleteMessageById(message._id);
    }, this.onSendMessageError);
  }

  onSendMessageError = async (error: unknown) => {
    const body = getTelegramErrorBody(error);
    if (body) {
      const isBlocked = isBlockedError(error);
      if (isBlocked) {
        await this.main.db.deleteChatById(this.chat.id);
        this.main.logs.chat.write(
          `[deleted] ${this.chat.id}, cause: (${body.error_code}) ${JSON.stringify(
            body.description,
          )}`,
        );
        throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
      } else if (body.parameters && body.parameters.migrate_to_chat_id) {
        const newChatId = body.parameters.migrate_to_chat_id;
        try {
          await this.main.db.changeChatId(this.chat.id, '' + newChatId);
        } catch (error) {
          const err = error as ErrorWithCode;
          if (/would lead to a duplicate entry in table/.test(err.message)) {
            await this.main.db.deleteChatById(this.chat.id);
            this.main.logs.chat.write(`[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`);
            throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
          }
          throw err;
        }

        this.main.logs.chat.write(`[migrate] ${this.chat.id} > ${newChatId}`);
        throw new ErrorWithCode(
          `Chat ${this.chat.id} is migrated to ${newChatId}`,
          'CHAT_IS_MIGRATED',
        );
      } else if (errHandler[ErrEnum.NotEnoughRightsSendPhotos](error)) {
        this.chat.isHidePreview = true;
        await this.chat.save();
        throw new ErrorWithCode(`Chat ${this.chat.id} is deny photos`, 'CHAT_IS_DENY_PHOTOS');
      }
    }
    throw error;
  };

  async sendStream(stream: StreamModelWithChannel) {
    let message;
    try {
      const previews = !Array.isArray(stream.previews)
        ? JSON.parse(stream.previews)
        : stream.previews;

      if (this.chat.isHidePreview || !previews.length) {
        message = await this.sendStreamAsText(stream);
      } else {
        message = await this.sendStreamAsPhoto(stream);
      }
    } catch (err) {
      if (isSkipMessageError(err)) {
        debug('skip message %s error: %o', this.chat.id, err);
        return this.main.db.deleteChatIdStreamId(this.chat.id, stream.id);
      }
      return this.onSendMessageError(err);
    }

    return Promise.all([
      this.main.db.deleteChatIdStreamId(this.chat.id, stream.id),
      this.main.db.putMessage({
        id: message.message.message_id.toString(),
        chatId: this.chat.id,
        streamId: stream.id,
        type: message.type,
        text: message.text,
      }),
    ]);
  }

  async sendStreamAsText(
    stream: StreamModelWithChannel,
    isFallback?: boolean,
  ): Promise<SentMessage> {
    const text = getStreamAsDescription(stream, this.main.getServiceById(stream.channel.service)!);

    const message = await this.main.bot.api.sendMessage({
      chat_id: this.chat.id,
      text,
      parse_mode: 'HTML',
    });

    let type;
    if (isFallback) {
      type = 'send message as fallback';
    } else {
      type = 'send message';
    }

    tracker.track(this.chat.id, {
      ec: 'bot',
      ea: 'sendMsg',
      el: stream.channelId,
      t: 'event',
    });

    this.main.logs.sender.write(
      `[${type}] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`,
    );

    return {
      type: 'text',
      text: text,
      message,
    };
  }

  async sendStreamAsPhoto(stream: StreamModelWithChannel): Promise<SentMessage> {
    if (stream.telegramPreviewFileId) {
      return this.ensureTelegramPreviewFileId(stream);
    } else {
      return this.requestAndSendPhoto(stream);
    }
  }

  requestAndSendPhoto(stream: StreamModelWithChannel): Promise<SentMessage> {
    return coordinatePreviewRequest(
      stream,
      () => this.ensureTelegramPreviewFileId(stream),
      (error) => {
        const err = error as ErrorWithCode;
        if (errHandler[ErrEnum.NotEnoughRightsSendPhotos](err)) {
          throw err;
        }
        return this.sendStreamAsText(stream, true).then((sentMessage: SentMessage) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return sentMessage;
        });
      },
      (error) => {
        const err = error as ErrorWithCode;
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendStreamAsText(stream, true);
        }
        return this.sendStreamAsPhoto(stream);
      },
    );
  }

  async ensureTelegramPreviewFileId(stream: StreamModelWithChannel): Promise<SentMessage> {
    const service = this.main.getServiceById(stream.channel.service)!;
    const previews = !Array.isArray(stream.previews)
      ? JSON.parse(stream.previews)
      : stream.previews;

    const caption = getStreamAsCaption(stream, service);
    const result = await sendPreviewPhoto({
      api: this.main.bot.api,
      chatId: this.chat.id,
      caption,
      previewUrls: previews,
      cachedFileId: stream.telegramPreviewFileId,
      headUnsupported: service.streamPreviewHeadUnsupported,
      cacheKey: service.noCachePreview ? stream.updatedAt.getTime() : undefined,
      head: async (url) => {
        const response = await fetchRequest(url, {
          method: 'HEAD',
          timeout: 5 * 1000,
          keepAlive: true,
          cookie: service.useCookies,
        });
        return {url: response.url, contentType: response.headers['content-type'] as string};
      },
      download: async (url) => {
        const response = await fetchRequest<NodeReadableStream>(url, {
          responseType: 'stream',
          keepAlive: true,
          cookie: service.useCookies,
        });
        return {body: response.body};
      },
      onCachedFileIdInvalid: () => {
        stream.telegramPreviewFileId = null;
      },
      onSent: (source, message) => {
        this.main.logs.sender.write(
          `[send photo as ${source}] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`,
        );
        tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event',
        });
      },
    });

    if (stream.telegramPreviewFileId !== result.fileId) {
      stream.telegramPreviewFileId = result.fileId;
      await stream.save();
    }

    return {
      type: 'photo',
      text: caption,
      message: result.message,
    };
  }

  async updateStreamMessage(
    type: string,
    chatId: string,
    messageId: number,
    stream: StreamModelWithChannel,
    text: string,
  ) {
    switch (type) {
      case 'text': {
        const message = await this.main.bot.api.editMessageText({
          text,
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
        });

        this.main.logs.sender.write(
          `[update text] ${chatId} ${messageId} ${stream.channelId} ${stream.id}`,
        );

        tracker.track(chatId, {
          ec: 'bot',
          ea: 'updateText',
          el: stream.channelId,
          t: 'event',
        });

        return message;
      }
      case 'photo': {
        const message = await this.main.bot.api.editMessageCaption({
          caption: text,
          chat_id: chatId,
          message_id: messageId,
        });

        this.main.logs.sender.write(
          `[update caption] ${chatId} ${messageId} ${stream.channelId} ${stream.id}`,
        );

        tracker.track(chatId, {
          ec: 'bot',
          ea: 'updatePhoto',
          el: stream.channelId,
          t: 'event',
        });

        return message;
      }
    }
  }

  async deleteStreamMessage(chatId: string, messageId: number) {
    const isSuccess = await this.main.bot.api.deleteMessage({
      chat_id: chatId,
      message_id: messageId,
    });
    this.main.logs.sender.write(`[delete] ${chatId} ${messageId}`);
    return isSuccess;
  }
}

export default ChatSender;
