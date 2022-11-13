import Main from "./main";
import promiseTry from "./tools/promiseTry";
import ErrorWithCode from "./tools/errorWithCode";
import {getStreamAsCaption, getStreamAsDescription} from "./tools/streamToString";
import {ServiceInterface} from "./checker";
import {TMessage} from "./router";
import appendQueryParam from "./tools/appendQueryParam";
import inlineInspect from "./tools/inlineInspect";
import fetchRequest from "./tools/fetchRequest";
import {ChatModel, MessageModel, StreamModelWithChannel} from "./db";

const debug = require('debug')('app:ChatSender');

const streamWeakMap = new WeakMap();

interface SentMessage {
  type: string,
  text: string,
  message: TMessage
}

class ChatSender {
  private streamIds: string[]|null;
  private messages: MessageModel[]|null;
  private readonly methods: string[];
  private methodIndex: number;
  aborted = false;
  lockCount = 0;
  startAt: number;
  lastActivityAt: number;
  constructor(private main: Main, public chat: ChatModel) {
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

    if (!this.streamIds.length) {
      return true;
    }

    const streamId = this.streamIds.shift()!;

    return this.main.sender.provideStream(streamId, (stream) => {
      return this.sendStream(stream);
    }).catch((err) => {
      if (err.code === 'STREAM_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {});
  }

  async update() {
    if (!this.messages || !this.messages.length) {
      this.messages = await this.getMessages();
    }

    if (!this.messages.length) {
      return true;
    }

    const message = this.messages.shift()!;

    return this.main.sender.provideStream(message.streamId, (stream) => {
      let text: string;
      if (message.type === 'text') {
        text = getStreamAsDescription(stream, this.main.getServiceById(stream.channel.service)!);
      } else {
        text = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);
      }

      return promiseTry(() => {
        if (message.text === text) return;

        return this.updateStreamMessage(message.type, message.chatId, message.id, stream, text).catch((err: any) => {
          if (err.code === 'ETELEGRAM' && /message is not modified/.test(err.response.body.description)) {
            return; // pass
          }
          throw err;
        });
      }).then(() => {
        return message.update({
          text,
          hasChanges: false
        });
      }, (err: any) => {
        if (err.code === 'ETELEGRAM' && /message to edit not found|message can't be edited/.test(err.response.body.description)) {
          return this.main.db.deleteMessageById(message._id);
        }
        return this.onSendMessageError(err);
      });
    }).catch((err) => {
      if (err.code === 'STREAM_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {});
  }

  async delete() {
    const messages = await this.getDeleteMessages();

    if (!messages.length) {
      return true;
    }

    const message = messages.shift()!;

    const minDeleteTime = new Date();
    minDeleteTime.setHours(minDeleteTime.getHours() - 48);

    return promiseTry(() => {
      if (this.chat.isEnabledAutoClean && message.createdAt.getTime() > minDeleteTime.getTime()) {
        return this.deleteStreamMessage(message.chatId, message.id);
      }
    }).catch((err) => {
      if (err.code === 'ETELEGRAM') {
        const body = err.response.body;

        const isSkipError = [
          /message to delete not found/,
          /message can't be deleted/,
          /group chat was upgraded/,
        ].some(re => re.test(body.description));

        if (isSkipError) {
          // pass
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }).then(() => {
      return this.main.db.deleteMessageById(message._id);
    }, this.onSendMessageError).then(() => {});
  }

  onSendMessageError = (err: any) => {
    if (err.code === 'ETELEGRAM') {
      const body = err.response.body;

      const isBlocked = isBlockedError(err);
      if (isBlocked) {
        return this.main.db.deleteChatById(this.chat.id).then(() => {
          this.main.chat.log.write(`[deleted] ${this.chat.id}, cause: (${body.error_code}) ${JSON.stringify(body.description)}`);
          throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
        });
      } else
      if (body.parameters && body.parameters.migrate_to_chat_id) {
        const newChatId = body.parameters.migrate_to_chat_id;
        return this.main.db.changeChatId(this.chat.id, '' + newChatId).then(() => {
          this.main.chat.log.write(`[migrate] ${this.chat.id} > ${newChatId}`);
          throw new ErrorWithCode(`Chat ${this.chat.id} is migrated to ${newChatId}`, 'CHAT_IS_MIGRATED');
        }, async (err: any) => {
          if (/would lead to a duplicate entry in table/.test(err.message)) {
            await this.main.db.deleteChatById(this.chat.id);
            this.main.chat.log.write(`[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`);
            throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
          }
          throw err;
        });
      } else
      if (/not enough rights to send photos/.test(body.description)) {
        this.chat.isHidePreview = true;

        return this.chat.save().then(() => {
          throw new ErrorWithCode(`Chat ${this.chat.id} is deny photos`, 'CHAT_IS_DENY_PHOTOS');
        });
      }
    }
    throw err;
  };

  sendStream(stream: StreamModelWithChannel) {
    return promiseTry(() => {
      if (this.chat.isHidePreview || !stream.previews.length) {
        return this.sendStreamAsText(stream);
      } else {
        return this.sendStreamAsPhoto(stream);
      }
    }).then((sendMessage: SentMessage) => {
      return Promise.all([
        this.main.db.deleteChatIdStreamId(this.chat.id, stream.id),
        this.main.db.putMessage({
          id: sendMessage.message.message_id.toString(),
          chatId: this.chat.id,
          streamId: stream.id,
          type: sendMessage.type,
          text: sendMessage.text,
        }),
      ]);
    }, this.onSendMessageError);
  }

  sendStreamAsText(stream: StreamModelWithChannel, isFallback?: boolean): Promise<SentMessage> {
    const text = getStreamAsDescription(stream, this.main.getServiceById(stream.channel.service)!);
    return this.main.bot.sendMessage(this.chat.id, text, {
      parse_mode: 'HTML'
    }).then((message: TMessage) => {
      let type;
      if (isFallback) {
        type = 'send message as fallback';
      } else {
        type = 'send message';
      }

      this.main.tracker.track(this.chat.id, {
        ec: 'bot',
        ea: 'sendMsg',
        el: stream.channelId,
        t: 'event'
      });

      this.main.sender.log.write(`[${type}] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`);

      return {
        type: 'text',
        text: text,
        message
      };
    });
  }

  sendStreamAsPhoto(stream: StreamModelWithChannel): Promise<SentMessage> {
    if (stream.telegramPreviewFileId) {
      const caption = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);
      return this.main.bot.sendPhotoQuote(this.chat.id, stream.telegramPreviewFileId, {caption}).then((message: TMessage) => {
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event'
        });

        this.main.sender.log.write(`[send photo as id] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`);

        return {
          type: 'photo',
          text: caption,
          message
        };
      }, (err: Error & any) => {
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          if (/FILE_REFERENCE_.+/.test(body.description)) {
            stream.telegramPreviewFileId = null;

            return this.sendStreamAsPhoto(stream);
          }
        }
        throw err;
      });
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
        if (err.code === 'ETELEGRAM' && /not enough rights to send photos/.test(err.response.body.description)) {
          throw err;
        }

        return this.sendStreamAsText(stream, true).then((sentMessage: SentMessage) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return sentMessage;
        });
      });
    } else {
      promise = promise.then(() => {
        return this.sendStreamAsPhoto(stream);
      }, (err: any) => {
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendStreamAsText(stream, true);
        } else {
          return this.sendStreamAsPhoto(stream);
        }
      });
    }

    return promise;
  }

  ensureTelegramPreviewFileId(stream: StreamModelWithChannel): Promise<SentMessage> {
    const service = this.main.getServiceById(stream.channel.service)!;
    const previews = !Array.isArray(stream.previews) ? JSON.parse(stream.previews) : stream.previews;
    return getValidPreviewUrl(previews, service).then(({url: _url, contentType}) => {
      let url = _url;
      if (service.noCachePreview) {
        url = appendQueryParam(url, '_', stream.updatedAt.getTime());
      }
      const caption = getStreamAsCaption(stream, this.main.getServiceById(stream.channel.service)!);
      return this.main.bot.sendPhoto(this.chat.id, url, {caption}).then((message: TMessage) => {
        this.main.sender.log.write(`[send photo as url] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`);
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event'
        });
        return message;
      }).catch((err: any) => {
        let isSendUrlError = sendUrlErrors.some(re => re.test(err.message));
        if (!isSendUrlError) {
          isSendUrlError = err.response && err.response.statusCode === 504;
        }

        if (isSendUrlError) {
          if (!contentType) {
            debug('Content-type is empty, set default content-type %s', url);
            contentType = 'image/jpeg';
          }
          return fetchRequest<ReadableStream>(url, {responseType: 'stream', keepAlive: true}).then((response) => {
            return this.main.bot.sendPhoto(this.chat.id, response.body, {caption}, {contentType, filename: '-'});
          }).then((message: TMessage) => {
            this.main.sender.log.write(`[send photo as file] ${this.chat.id} ${message.message_id} ${stream.channelId} ${stream.id}`);
            this.main.tracker.track(this.chat.id, {
              ec: 'bot',
              ea: 'sendPhoto',
              el: stream.channelId,
              t: 'event'
            });
            return message;
          });
        }

        throw err;
      }).then((message: TMessage) => {
        const fileId = getPhotoFileIdFromMessage(message);
        if (!fileId) {
          throw new ErrorWithCode('File id if not found', 'FILE_ID_IS_NOT_FOUND');
        }
        stream.telegramPreviewFileId = fileId;

        return stream.save().then(() => {
          return {
            type: 'photo',
            text: caption,
            message
          };
        });
      });
    });
  }

  updateStreamMessage(type: string, chatId: string, messageId: string, stream: StreamModelWithChannel, text: string) {
    switch (type) {
      case 'text': {
        return this.main.bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        }).then((message: TMessage|boolean) => {
          this.main.sender.log.write(`[update text] ${chatId} ${messageId} ${stream.channelId} ${stream.id}`);
          this.main.tracker.track(chatId, {
            ec: 'bot',
            ea: 'updateText',
            el: stream.channelId,
            t: 'event'
          });
          return message;
        });
      }
      case 'photo': {
        return this.main.bot.editMessageCaption(text, {
          chat_id: chatId,
          message_id: messageId
        }).then((message: TMessage|boolean) => {
          this.main.sender.log.write(`[update caption] ${chatId} ${messageId} ${stream.channelId} ${stream.id}`);
          this.main.tracker.track(chatId, {
            ec: 'bot',
            ea: 'updatePhoto',
            el: stream.channelId,
            t: 'event'
          });
          return message;
        });
      }
    }
  }

  deleteStreamMessage(chatId: string, messageId: string) {
    return this.main.bot.deleteMessage(chatId, messageId).then((isSuccess: boolean) => {
      this.main.sender.log.write(`[delete] ${chatId} ${messageId}`);
      return isSuccess;
    });
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

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/,
  /FILE_REFERENCE_.+/,
];

function getPhotoFileIdFromMessage(message: TMessage): string|null {
  let fileId = null;
  message.photo!.slice(0).sort((a, b) => {
    return a.file_size! > b.file_size! ? -1 : 1;
  }).some(item => fileId = item.file_id);
  return fileId;
}

async function getValidPreviewUrl(urls: string[], service: ServiceInterface) {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      return await fetchRequest(urls[i], {
        method: 'HEAD',
        timeout: 5 * 1000,
        keepAlive: true,
      }).then((response) => {
        const url = response.url;
        const contentType = response.headers['content-type'] as string;
        return {url, contentType};
      });
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
      isBlocked = blockedErrors.some(re => re.test(body.description));
    }

    return isBlocked;
  }
  return false;
}

export default ChatSender;