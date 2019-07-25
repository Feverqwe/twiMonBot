import Main from "./main";
import {IChat, IStream} from "./db";
import promiseTry from "./tools/promiseTry";
import ErrorWithCode from "./tools/errorWithCode";
import promiseFinally from "./tools/promiseFinally";
import htmlSanitize from "./tools/htmlSanitize";

const debug = require('debug')('app:ChatSender');
const got = require('got');

const videoWeakMap = new WeakMap();

class ChatSender {
  main: Main;
  chat: IChat;
  private streamIds: string[]|null;
  constructor(main: Main, chat: IChat) {
    this.main = main;
    this.chat = chat;

    this.streamIds = null;
  }

  getStreamIds() {
    return this.main.db.getStreamIdsByChatId(this.chat.id, 10);
  }

  async next() {
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
      }).catch((err) => {
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
      }).then(() => {
        return this.main.db.deleteChatIdStreamId(this.chat.id, stream.id);
      });
    }).catch((err) => {
      if (err.code === 'STREAM_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {});
  }

  sendStreamAsText(stream: IStream, isFallback?: boolean) {
    return this.main.bot.sendMessage(this.chat.id, getDescription(stream), {
      parse_mode: 'HTML'
    }).then(() => {
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
      this.main.sender.log.write(`[${type}] ${this.chat.id} ${stream.channelId} ${stream.id}`);
    });
  }

  sendStreamAsPhoto(stream: IStream) {
    if (stream.telegramPreviewFileId) {
      return this.main.bot.sendPhotoQuote(this.chat.id, stream.telegramPreviewFileId, {
        caption: getCaption(stream)
      }).then((result) => {
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event'
        });
        this.main.sender.log.write(`[send photo as id] ${this.chat.id} ${stream.channelId} ${stream.id}`);
        return result;
      });
    } else {
      return this.requestAndSendPhoto(stream);
    }
  }

  requestAndSendPhoto(stream: IStream) {
    let promise = videoWeakMap.get(stream);

    if (!promise) {
      promise = this.ensureTelegramPreviewFileId(stream).then(...promiseFinally(() => {
        videoWeakMap.delete(stream);
      }));
      videoWeakMap.set(stream, promise);
      promise = promise.catch((err) => {
        if (err.code === 'ETELEGRAM' && /not enough rights to send photos/.test(err.response.body.description)) {
          throw err;
        }
        return this.sendStreamAsText(stream, true).then((result) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return result;
        });
      });
    } else {
      promise = promise.then(() => {
        return this.sendStreamAsPhoto(stream);
      }, (err) => {
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendStreamAsText(stream, true);
        } else {
          return this.sendStreamAsPhoto(stream);
        }
      });
    }

    return promise;
  }

  ensureTelegramPreviewFileId(stream: IStream) {
    const previews = !Array.isArray(stream.previews) ? JSON.parse(stream.previews) : stream.previews;
    return getValidPreviewUrl(previews).then(({url, contentType}) => {
      const caption = getCaption(stream);
      return this.main.bot.sendPhoto(this.chat.id, url, {caption}).then((result) => {
        this.main.sender.log.write(`[send photo as url] ${this.chat.id} ${stream.channelId} ${stream.id}`);
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: stream.channelId,
          t: 'event'
        });
        return result;
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
          return this.main.bot.sendPhoto(this.chat.id, got.stream(url), {caption}, {contentType}).then((result) => {
            this.main.sender.log.write(`[send photo as file] ${this.chat.id} ${stream.channelId} ${stream.id}`);
            this.main.tracker.track(this.chat.id, {
              ec: 'bot',
              ea: 'sendPhoto',
              el: stream.channelId,
              t: 'event'
            });
            return result;
          });
        }

        throw err;
      });
    }).then((response) => {
      const fileId = getPhotoFileIdFromMessage(response);
      if (!fileId) {
        throw new ErrorWithCode('File id if not found', 'FILE_ID_IS_NOT_FOUND');
      }
      stream.telegramPreviewFileId = fileId;
      return stream.save();
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

function getPhotoFileIdFromMessage(response: {photo: {file_id: string, file_size: number}[]}): string|null {
  let fileId = null;
  response.photo.slice(0).sort((a, b) => {
    return a.file_size > b.file_size ? -1 : 1;
  }).some(item => fileId = item.file_id);
  return fileId;
}

async function getValidPreviewUrl(urls: string[]): Promise<{
  url: string, contentType: string
}> {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      return await got.head(urls[i], {timeout: 5 * 1000}).then((response: any) => {
        const url = response.url;
        const contentType = response.headers['content-type'];
        return {url, contentType};
      });
    } catch (err) {
      lastError = err;
    }
  }
  debug('getValidPreviewUrl error %o', lastError);
  throw new ErrorWithCode(`Previews is invalid`, 'INVALID_PREVIEWS');
}

function getDescription(stream: IStream) {
  const lines = [];

  const firstLine = [
    htmlSanitize(stream.title), '—', htmlSanitize(stream.channel.title)
  ];

  const secondLine = [stream.url];

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

function getCaption(stream: IStream) {
  const lines = [];

  const firstLine = [
    stream.title, '—', stream.channel.title
  ];

  const secondLine = [stream.url];

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
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