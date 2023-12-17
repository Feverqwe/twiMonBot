import Main from './main';
import promiseTry from './tools/promiseTry';
import ErrorWithCode from './tools/errorWithCode';
import {getStreamAsCaption, getStreamAsDescription} from './tools/streamToString';
import {ServiceInterface} from './checker';
import appendQueryParam from './tools/appendQueryParam';
import inlineInspect from './tools/inlineInspect';
import fetchRequest from './tools/fetchRequest';
import {ChatModel, MessageModel, StreamModelWithChannel} from './db';
import {getDebug} from './tools/getDebug';
import TelegramBot from 'node-telegram-bot-api';
import {tracker} from './tracker';
import {ErrEnum, errHandler, passEx} from './tools/passTgEx';
import {TelegramError} from './types';
import ReadableStream = NodeJS.ReadableStream;
import {Stream} from 'stream';

const debug = getDebug('app:ChatSender');

const streamWeakMap = new WeakMap();

interface SentMessage {
  type: string;
  text: string;
  message: TelegramBot.Message;
}

class ChatSender {
  private streamIds: string[] | null;
  private messages: MessageModel[] | null;
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
          const err = error as TelegramError;
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
        const err = error as TelegramError;
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          const isSkipError = [
            /message to delete not found/,
            /message can't be deleted/,
            /group chat was upgraded/,
          ].some((re) => re.test(body.description));

          if (isSkipError) {
            // pass
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }).then(() => {
      return this.main.db.deleteMessageById(message._id);
    }, this.onSendMessageError);
  }

  onSendMessageError = async (error: unknown) => {
    const err = error as TelegramError;
    if (err.code === 'ETELEGRAM') {
      const body = err.response.body;

      const isBlocked = isBlockedError(err);
      if (isBlocked) {
        await this.main.db.deleteChatById(this.chat.id);
        this.main.chat.log.write(
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
            this.main.chat.log.write(`[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`);
            throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
          }
          throw err;
        }

        this.main.chat.log.write(`[migrate] ${this.chat.id} > ${newChatId}`);
        throw new ErrorWithCode(
          `Chat ${this.chat.id} is migrated to ${newChatId}`,
          'CHAT_IS_MIGRATED',
        );
      } else if (/not enough rights to send photos/.test(body.description)) {
        this.chat.isHidePreview = true;
        await this.chat.save();
        throw new ErrorWithCode(`Chat ${this.chat.id} is deny photos`, 'CHAT_IS_DENY_PHOTOS');
      }
    }
    throw err;
  };

  async sendStream(stream: StreamModelWithChannel) {
    let message;
    try {
      if (this.chat.isHidePreview || !stream.previews.length) {
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

    const message = await this.main.bot.sendMessage(this.chat.id, text, {
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

    this.main.sender.log.write(
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
      const caption = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);

      let message;
      try {
        message = await this.main.bot.sendPhotoQuote(this.chat.id, stream.telegramPreviewFileId, {
          caption,
        });
      } catch (error) {
        const err = error as TelegramError;
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          if (/FILE_REFERENCE_.+/.test(body.description)) {
            stream.telegramPreviewFileId = null;

            return this.sendStreamAsPhoto(stream);
          }
        }
        throw err;
      }

      tracker.track(this.chat.id, {
        ec: 'bot',
        ea: 'sendPhoto',
        el: stream.channelId,
        t: 'event',
      });

      this.main.sender.log.write(
        `[send photo as id] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`,
      );

      return {
        type: 'photo',
        text: caption,
        message,
      };
    } else {
      return this.requestAndSendPhoto(stream);
    }
  }

  requestAndSendPhoto(stream: StreamModelWithChannel): Promise<SentMessage> {
    let promise: Promise<SentMessage> = streamWeakMap.get(stream);

    if (!promise) {
      promise = this.ensureTelegramPreviewFileId(stream).finally(() => {
        streamWeakMap.delete(stream);
      });
      streamWeakMap.set(stream, promise);
      promise = promise.catch((err: any) => {
        if (
          err.code === 'ETELEGRAM' &&
          /not enough rights to send photos/.test(err.response.body.description)
        ) {
          throw err;
        }

        return this.sendStreamAsText(stream, true).then((sentMessage: SentMessage) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return sentMessage;
        });
      });
    } else {
      promise = promise.then(
        () => {
          return this.sendStreamAsPhoto(stream);
        },
        (err: any) => {
          if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
            return this.sendStreamAsText(stream, true);
          } else {
            return this.sendStreamAsPhoto(stream);
          }
        },
      );
    }

    return promise;
  }

  async ensureTelegramPreviewFileId(stream: StreamModelWithChannel): Promise<SentMessage> {
    const service = this.main.getServiceById(stream.channel.service)!;
    const previews = !Array.isArray(stream.previews)
      ? JSON.parse(stream.previews)
      : stream.previews;

    let url: string;
    let contentType: string;
    if (service.streamPreviewHeadUnsupported) {
      url = stream.previews[0];
    } else {
      const {url: urlLocal, contentType: contentTypeLocal} = await getValidPreviewUrl(
        previews,
        service,
      );
      contentType = contentTypeLocal;
      url = urlLocal;
    }
    if (!url) {
      const err = new ErrorWithCode(`Preview url is empty`, 'INVALID_PREVIEWS');
    }
    if (service.noCachePreview) {
      url = appendQueryParam(url, '_', stream.updatedAt.getTime());
    }
    const caption = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);

    const message = await promiseTry(async () => {
      try {
        const message = await this.main.bot.sendPhoto(this.chat.id, url, {caption});

        this.main.sender.log.write(
          `[send photo as url] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`,
        );

        tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event',
        });

        return message;
      } catch (error) {
        const err = error as TelegramError;

        let isSendUrlError = sendUrlErrors.some((re) => re.test(err.message));
        if (!isSendUrlError) {
          isSendUrlError = err.response && err.response.statusCode === 504;
        }

        if (isSendUrlError) {
          if (!contentType) {
            debug('Content-type is empty, set default content-type %s', url);
            contentType = 'image/jpeg';
          }

          const response = await fetchRequest<ReadableStream>(url, {
            responseType: 'stream',
            keepAlive: true,
          });

          const message = await this.main.bot.sendPhoto(
            this.chat.id,
            response.body as unknown as Stream,
            {caption},
            {contentType, filename: '-'},
          );

          this.main.sender.log.write(
            `[send photo as file] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`,
          );

          tracker.track(this.chat.id, {
            ec: 'bot',
            ea: 'sendPhoto',
            el: stream.channelId,
            t: 'event',
          });

          return message;
        }

        throw err;
      }
    });

    const fileId = getPhotoFileIdFromMessage(message);
    if (!fileId) {
      throw new ErrorWithCode('File id if not found', 'FILE_ID_IS_NOT_FOUND');
    }
    stream.telegramPreviewFileId = fileId;

    await stream.save();

    return {
      type: 'photo',
      text: caption,
      message,
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
        const message = await this.main.bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
        });

        this.main.sender.log.write(
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
        const message = await this.main.bot.editMessageCaption(text, {
          chat_id: chatId,
          message_id: messageId,
        });

        this.main.sender.log.write(
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
    const isSuccess = await this.main.bot.deleteMessage(chatId, messageId);
    this.main.sender.log.write(`[delete] ${chatId} ${messageId}`);
    return isSuccess;
  }
}

const blockedErrors = [
  /group chat was deactivated/,
  /group chat is deactivated/,
  /chat not found/,
  /channel not found/,
  /USER_DEACTIVATED/,
  /have no rights to send a message/,
  /need administrator rights in the channel chat/,
  /CHAT_WRITE_FORBIDDEN/,
  /CHAT_SEND_MEDIA_FORBIDDEN/,
  /CHAT_RESTRICTED/,
  /not enough rights to send text messages to the chat/,
  /TOPIC_DELETED/,
];

const skipMsgErrors = [/TOPIC_DELETED/, /TOPIC_CLOSED/];

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/,
  /FILE_REFERENCE_.+/,
];

function getPhotoFileIdFromMessage(message: TelegramBot.Message): string | null {
  let fileId = null;
  message.photo
    ?.slice(0)
    .sort((a, b) => {
      return a.file_size! > b.file_size! ? -1 : 1;
    })
    .some((item) => (fileId = item.file_id));
  return fileId;
}

async function getValidPreviewUrl(urls: string[], service: ServiceInterface) {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      const response = await fetchRequest(urls[i], {
        method: 'HEAD',
        timeout: 5 * 1000,
        keepAlive: true,
      });
      const url = response.url;
      const contentType = response.headers['content-type'] as string;
      return {url, contentType};
    } catch (err) {
      lastError = err;
    }
  }
  const err = new ErrorWithCode(`Previews is invalid`, 'INVALID_PREVIEWS');
  Object.assign(err, {original: lastError});
  throw err;
}

export function isBlockedError(err: any) {
  if (err.code === 'ETELEGRAM') {
    const body = err.response.body;

    let isBlocked = body.error_code === 403;
    if (!isBlocked) {
      isBlocked = blockedErrors.some((re) => re.test(body.description));
    }

    return isBlocked;
  }
  return false;
}

export function isSkipMessageError(err: any) {
  if (err.code === 'ETELEGRAM') {
    const body = err.response.body;

    return skipMsgErrors.some((re) => re.test(body.description));
  }
  return false;
}

export default ChatSender;
