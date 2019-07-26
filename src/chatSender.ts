import Main from "./main";
import {IChat, IMessage, IStream, IStreamWithChannel} from "./db";
import promiseTry from "./tools/promiseTry";
import ErrorWithCode from "./tools/errorWithCode";
import promiseFinally from "./tools/promiseFinally";
import {getCaption, getDescription} from "./tools/streamToString";
import {ServiceInterface} from "./checker";

const debug = require('debug')('app:ChatSender');
const got = require('got');

const videoWeakMap = new WeakMap();

interface TUser {
  id: number,
  is_bot: boolean,
  first_name: string,
  last_name?: string,
  username?: string,
  language_code?: string
}

interface TChat {
  id: number,
  type: string,
  title?: string,
  username?: string,
  first_name?: string,
  last_name?: string,
  all_members_are_administrators?: true,
  photo?: TChatPhoto,
  description?: string,
  invite_link?: string,
  pinned_message?: TMessage,
  sticker_set_name?: string,
  can_set_sticker_set?: boolean
}

interface TMessage {
  message_id: number,
  from?: TUser // empty for messages sent to channels
  date: number,
  chat: TChat,
  forward_from?: TUser,
  forward_from_chat?: TChat,
  forward_from_message_id?: number,
  forward_signature?: string,
  forward_sender_name?: string,
  forward_date?: number,
  reply_to_message?: TMessage,
  edit_date?: number,
  media_group_id?: string,
  author_signature?: string,
  text?: string,
  entities?: TMessageEntity[],
  caption_entities?: TMessageEntity[],
  audio?: any,
  document?: any,
  animation?: any,
  game?: any,
  photo?: TPhotoSize[],
  sticker?: any,
  video?: any,
  voice?: any,
  video_note?: any,
  caption?: string,
  contact?: any,
  location?: any,
  venue?: any,
  poll?: any,
  new_chat_members?: TUser[],
  left_chat_member?: TUser,
  new_chat_title?: string,
  new_chat_photo?: TPhotoSize[],
  delete_chat_photo?: true,
  group_chat_created?: true,
  supergroup_chat_created?: true,
  channel_chat_created?: true,
  migrate_to_chat_id?: number,
  migrate_from_chat_id?: number,
  pinned_message?: TMessage,
  invoice?: any,
  successful_payment?: any,
  connected_website?: string,
  passport_data?: any,
  reply_markup?: TInlineKeyboardMarkup,
}

interface TMessageEntity {
  type: string,
  offset: number,
  length: number,
  url?: string,
  user?: TUser
}

interface TPhotoSize {
  file_id: string,
  width: number,
  height: number,
  file_size?: number
}

interface TInlineKeyboardMarkup {
  inline_keyboard: TInlineKeyboardButton[][]
}

interface TInlineKeyboardButton {
  text: string,
  url?: string,
  login_url?: any,
  callback_data?: string,
  switch_inline_query?: string,
  switch_inline_query_current_chat?: string,
  callback_game?: any,
  pay?: boolean,
}

interface TChatPhoto {
  small_file_id: string,
  big_file_id: string
}

interface SentMessage {
  type: string,
  text: string,
  message: TMessage
}

class ChatSender {
  main: Main;
  chat: IChat;
  private streamIds: string[]|null;
  private messages: IMessage[]|null;
  private methods: string[];
  private methodIndex: number;
  constructor(main: Main, chat: IChat) {
    this.main = main;
    this.chat = chat;

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
    const method = this.methods[this.methodIndex];
    return promiseTry(() => {
      switch (method) {
        case 'send': {
          return this.send();
        }
        case 'update': {
          return this.update();
        }
        case 'delete': {
          return this.delete();
        }
        default: {
          return true;
        }
      }
    }).then((isDone: boolean|void) => {
      if (isDone) {
        this.methodIndex++;
      }
      if (this.methods.length === this.methodIndex) {
        this.methodIndex = 0;
        return true;
      }
    });
  }

  async send() {
    if (!this.streamIds || !this.streamIds.length) {
      this.streamIds = await this.getStreamIds();
    }

    if (!this.streamIds.length) {
      return true;
    }

    return this.main.sender.provideStream(this.streamIds.shift(), (stream) => {
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

    const message = this.messages.shift();

    return this.main.sender.provideStream(message.streamId, (stream) => {
      let text: string = null;
      if (message.type === 'text') {
        text = getDescription(stream);
      } else {
        text = getCaption(stream);
      }
      if (message.text === text) return;

      return this.updateStreamMessage(message.type, message.chatId, message.id, stream, text).catch((err: any) => {
        if (err.code === 'ETELEGRAM' && /message is not modified/.test(err.response.body.description)) {
          return; // pass
        }
        throw err;
      }).then(() => {
        return message.update({
          text,
          hasChanges: false
        });
      }, (err: any) => {
        if (err.code === 'ETELEGRAM' && /message to edit not found/.test(err.response.body.description)) {
          return this.main.db.deleteMessageById(message.id);
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

    const message = this.messages.shift();

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

        if (!isSkipError) {
          throw err;
        } else {
          // pass
        }
      }
      throw err;
    }).then(() => {
      return this.main.db.deleteMessageById(message.id);
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
        return this.main.db.changeChatId(this.chat.id, newChatId).then(() => {
          this.main.chat.log.write(`[migrate] ${this.chat.id} > ${newChatId}`);
          throw new ErrorWithCode(`Chat ${this.chat.id} is migrated to ${newChatId}`, 'CHAT_IS_MIGRATED');
        });
      }
    }
    throw err;
  };

  sendStreamAsText(stream: IStreamWithChannel, isFallback?: boolean): Promise<SentMessage> {
    const text = getDescription(stream);
    return this.main.bot.sendMessage(this.chat.id, text, {
      parse_mode: 'HTML'
    }).then((message: TMessage) => {
      let type = null;
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

  sendStreamAsPhoto(stream: IStreamWithChannel): Promise<SentMessage> {
    if (stream.telegramPreviewFileId) {
      const caption = getCaption(stream);
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
      });
    } else {
      return this.requestAndSendPhoto(stream);
    }
  }

  requestAndSendPhoto(stream: IStreamWithChannel): Promise<SentMessage> {
    let promise: Promise<SentMessage> = videoWeakMap.get(stream);

    if (!promise) {
      promise = this.ensureTelegramPreviewFileId(stream).then(...promiseFinally(() => {
        videoWeakMap.delete(stream);
      }));
      videoWeakMap.set(stream, promise);
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

  ensureTelegramPreviewFileId(stream: IStreamWithChannel): Promise<SentMessage> {
    const service = this.main.getServiceById(stream.id);
    const previews = !Array.isArray(stream.previews) ? JSON.parse(stream.previews) : stream.previews;
    return getValidPreviewUrl(previews, service).then(({url, contentType, agent}) => {
      const caption = getCaption(stream);
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
          return this.main.bot.sendPhoto(this.chat.id, got.stream(url, {agent}), {caption}, {contentType}).then((message: TMessage) => {
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

  updateStreamMessage(type: string, chatId: string, messageId: string, stream: IStream, text: string) {
    switch (type) {
      case 'text': {
        return this.main.bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        }).then((isSuccess: boolean) => {
          this.main.sender.log.write(`[update text] ${chatId} ${messageId} ${isSuccess}`);
          this.main.tracker.track(chatId, {
            ec: 'bot',
            ea: 'updateText',
            el: stream.channelId,
            t: 'event'
          });
          return isSuccess;
        });
      }
      case 'photo': {
        return this.main.bot.editMessageCaption(text, {
          chat_id: chatId,
          message_id: messageId
        }).then((isSuccess: boolean) => {
          this.main.sender.log.write(`[update caption] ${chatId} ${messageId} ${isSuccess}`);
          this.main.tracker.track(chatId, {
            ec: 'bot',
            ea: 'updatePhoto',
            el: stream.channelId,
            t: 'event'
          });
          return isSuccess;
        });
      }
    }
  }

  deleteStreamMessage(chatId: string, messageId: string) {
    return this.main.bot.deleteMessage(chatId, messageId).then((isSuccess: boolean) => {
      this.main.sender.log.write(`[delete] ${chatId} ${messageId} ${isSuccess}`);
      return isSuccess;
    });
  }
}

const blockedErrors = [
  /group chat is deactivated/,
  /chat not found/,
  /channel not found/,
  /USER_DEACTIVATED/,
  /not enough rights to send photos to the chat/,
  /have no rights to send a message/,
  /need administrator rights in the channel chat/,
  /CHAT_WRITE_FORBIDDEN/,
  /CHAT_SEND_MEDIA_FORBIDDEN/
];

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/
];

function getPhotoFileIdFromMessage(message: TMessage): string|null {
  let fileId = null;
  message.photo.slice(0).sort((a, b) => {
    return a.file_size > b.file_size ? -1 : 1;
  }).some(item => fileId = item.file_id);
  return fileId;
}

async function getValidPreviewUrl(urls: string[], service: ServiceInterface): Promise<{ url: string; contentType: string, agent: object }> {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      let gotFn = got;
      if (service.withProxy) {
        gotFn = service.gotWithProxy;
      }
      return await gotFn(urls[i], {method: 'HEAD', timeout: 5 * 1000}).then((response: any) => {
        const url = response.url;
        const contentType = response.headers['content-type'];
        const agent = response.request.gotOptions.agent;
        return {url, contentType, agent};
      });
    } catch (err) {
      lastError = err;
    }
  }
  debug('getValidPreviewUrl error %o', lastError);
  throw new ErrorWithCode(`Previews is invalid`, 'INVALID_PREVIEWS');
}

function isBlockedError(err: any) {
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