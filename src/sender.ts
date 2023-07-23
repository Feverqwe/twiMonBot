import Main from './main';
import LogFile from './logFile';
import {everyMinutes} from './tools/everyTime';
import getProvider from './tools/getProvider';
import ChatSender, {isBlockedError} from './chatSender';
import arrayUniq from './tools/arrayUniq';
import parallel from './tools/parallel';
import getInProgress from './tools/getInProgress';
import promiseLimit from './tools/promiseLimit';
import {appConfig} from './appConfig';
import {getDebug} from './tools/getDebug';
import throttle from 'lodash.throttle';
import {TelegramError} from './types';

const debug = getDebug('app:Sender');

const oneLimit = promiseLimit(1);

class Sender {
  public log = new LogFile('sender');
  constructor(private main: Main) {}

  init() {
    this.startCheckInterval();
    this.startCleanInterval();
  }

  checkTimer: (() => void) | null = null;
  startCheckInterval() {
    this.checkTimer && this.checkTimer();
    this.checkTimer = everyMinutes(appConfig.emitSendMessagesEveryMinutes, () => {
      this.check().catch((err: any) => {
        debug('check error', err);
      });
    });
  }

  cleanTimer: (() => void) | null = null;
  startCleanInterval() {
    this.cleanTimer && this.cleanTimer();
    this.cleanTimer = everyMinutes(appConfig.emitCheckExistsChatsEveryHours * 60, () => {
      this.checkChatsExists().catch((err) => {
        debug('checkChatsExists error', err);
      });
    });
  }

  check = () => {
    return oneLimit(async () => {
      const results = await Promise.all([
        this.main.db.getDistinctChatIdStreamIdChatIds(),
        this.main.db.getDistinctMessagesChatIds(),
      ]);

      const chatIds = arrayUniq(([] as string[]).concat(...results));
      const newChatIds = chatIds.filter((chatId) => !this.chatIdChatSender.has(chatId));

      const chats = await this.main.db.getChatsByIds(newChatIds);

      chats.forEach((chat) => {
        const existsThread = this.chatIdChatSender.get(chat.id);
        if (existsThread) {
          if (existsThread.lastActivityAt < Date.now() - 5 * 60 * 1000) {
            existsThread.lockCount++;
            if (existsThread.lockCount > 3) {
              existsThread.aborted = true;
              this.chatIdChatSender.delete(chat.id);
              debug('Drop locked thread', existsThread.chat.id);
            } else {
              debug('Thread lock', existsThread.chat.id);
              return;
            }
          } else {
            return;
          }
        }
        const chatSender = new ChatSender(this.main, chat);
        this.chatIdChatSender.set(chat.id, chatSender);
        this.suspended.push(chatSender);
      });

      this.fillThreads();

      return {addedCount: chats.length};
    });
  };
  checkThrottled = throttle(this.check, 1000, {
    leading: false,
  });

  getActiveThreads = async () => {
    return Array.from(this.chatIdChatSender.values()).map((chatSender) => {
      const {chat, startAt, lastActivityAt} = chatSender;
      return {
        chatId: chat.id,
        startedMinAgo: ((Date.now() - startAt) / 60 / 1000).toFixed(2),
        lastActivityMinAgo: ((Date.now() - lastActivityAt) / 60 / 1000).toFixed(2),
      };
    });
  };

  threadLimit = 10;
  chatIdChatSender = new Map<string, ChatSender>();
  suspended: ChatSender[] = [];
  threads: ChatSender[] = [];

  fillThreads() {
    for (let i = 0; i < this.threadLimit; i++) {
      this.runThread();
    }
  }

  async runThread() {
    const {threadLimit, chatIdChatSender, suspended, threads} = this;

    if (!suspended.length && !threads.length) return;
    if (!suspended.length || threads.length === threadLimit) return;

    const chatSender = suspended.shift();
    if (!chatSender) return;

    threads.push(chatSender);

    const isDone = await (async () => {
      try {
        return await chatSender.next();
      } catch (err) {
        debug('chatSender %s stopped, cause: %o', chatSender.chat.id, err);
        await this.main.db.setChatSendTimeoutExpiresAt([chatSender.chat.id]);
        return true;
      }
    })();

    const pos = threads.indexOf(chatSender);
    if (pos !== -1) {
      threads.splice(pos, 1);
    }
    if (isDone) {
      chatIdChatSender.delete(chatSender.chat.id);
    } else {
      suspended.push(chatSender);
    }
    this.fillThreads();
  }

  provideStream = getProvider((id: string) => {
    return this.main.db.getStreamWithChannelById(id);
  }, 100);

  checkChatsExistsInProgress = getInProgress();
  checkChatsExists = () => {
    return this.checkChatsExistsInProgress(async () => {
      let offset = 0;
      let limit = 100;
      const result = {
        chatCount: 0,
        removedCount: 0,
        errorCount: 0,
      };
      while (true) {
        const chatIds = await this.main.db.getChatIds(offset, limit);
        offset += limit;
        if (!chatIds.length) break;

        const blockedChatIds: string[] = [];

        await parallel(10, chatIds, async (chatId) => {
          result.chatCount++;

          try {
            await this.main.bot.sendChatAction(chatId, 'typing');
          } catch (error) {
            const err = error as TelegramError;
            const isBlocked = isBlockedError(err);
            if (isBlocked) {
              blockedChatIds.push(chatId);
              const body = err.response.body;
              this.main.chat.log.write(
                `[deleted] ${chatId}, cause: (${body.error_code}) ${JSON.stringify(
                  body.description,
                )}`,
              );
            } else {
              debug('checkChatsExists sendChatAction typing to %s error, cause: %o', chatId, err);
              result.errorCount++;
            }
          }
        });

        await this.main.db.deleteChatsByIds(blockedChatIds);

        result.removedCount += blockedChatIds.length;
        offset -= blockedChatIds.length;
      }
      return result;
    });
  };
}

export default Sender;
