import Main from "./main";
import LogFile from "./logFile";
import {everyMinutes} from "./tools/everyTime";
import getProvider from "./tools/getProvider";
import ChatSender, {isBlockedError} from "./chatSender";
import arrayUniq from "./tools/arrayUniq";
import parallel from "./tools/parallel";
import getInProgress from "./tools/getInProgress";
import promiseLimit from "./tools/promiseLimit";

const debug = require('debug')('app:Sender');
const throttle = require('lodash.throttle');

const oneLimit = promiseLimit(1);

class Sender {
  main: Main;
  log: LogFile;
  constructor(main: Main) {
    this.main = main;
    this.log = new LogFile('sender');
  }

  init() {
    this.startCheckInterval();
    this.startCleanInterval();
  }

  checkTimer: Function = null;
  startCheckInterval() {
    this.checkTimer && this.checkTimer();
    this.checkTimer = everyMinutes(this.main.config.emitSendMessagesEveryMinutes, () => {
      this.check().catch((err: any) => {
        debug('check error', err);
      });
    });
  }

  cleanTimer: Function = null;
  startCleanInterval() {
    this.cleanTimer && this.cleanTimer();
    this.cleanTimer = everyMinutes(this.main.config.emitCheckExistsChatsEveryHours * 60, () => {
      this.checkChatsExists().catch((err) => {
        debug('checkChatsExists error', err);
      });
    });
  }

  check = () => {
    return oneLimit(() => {
      return Promise.all([
        this.main.db.getDistinctChatIdStreamIdChatIds(),
        this.main.db.getDistinctMessagesChatIds(),
      ]).then((results) => {
        const chatIds = arrayUniq([].concat(...results));
        const newChatIds = chatIds.filter(chatId => !this.chatIdChatSender.has(chatId));
        return this.main.db.getChatsByIds(newChatIds).then((chats) => {
          chats.forEach((chat) => {
            const existsThread = this.chatIdChatSender.get(chat.id);
            if (existsThread) {
              if (existsThread.lastActivityAt < Date.now() - 5 * 60 * 1000) {
                debug('Thread lock', existsThread.chat.id);
              }
              return;
            }
            const chatSender = new ChatSender(this.main, chat);
            this.chatIdChatSender.set(chat.id, chatSender);
            this.suspended.push(chatSender);
          });

          this.fillThreads();

          return {addedCount: chats.length};
        });
      });
    });
  };
  checkThrottled = throttle(this.check, 1000, {
    leading: false
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

  runThread() {
    const {threadLimit, chatIdChatSender, suspended, threads} = this;

    if (!suspended.length && !threads.length) return;
    if (!suspended.length || threads.length === threadLimit) return;

    const chatSender = suspended.shift();
    threads.push(chatSender);

    return chatSender.next().catch(async (err: any) => {
      debug('chatSender %s stopped, cause: %o', chatSender.chat.id, err);
      await this.main.db.setChatSendTimeoutExpiresAt([chatSender.chat.id]);
      return true;
    }).then((isDone?: boolean|void) => {
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
    });
  }

  provideStream = getProvider((id: string) => {
    return this.main.db.getStreamWithChannelById(id);
  }, 100);

  checkChatsExistsInProgress = getInProgress();
  checkChatsExists() {
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

        await parallel(10, chatIds, (chatId) => {
          result.chatCount++;
          return this.main.bot.sendChatAction(chatId, 'typing').catch((err: any) => {
            const isBlocked = isBlockedError(err);
            if (isBlocked) {
              blockedChatIds.push(chatId);
              const body = err.response.body;
              this.main.chat.log.write(`[deleted] ${chatId}, cause: (${body.error_code}) ${JSON.stringify(body.description)}`);
            } else {
              debug('checkChatsExists sendChatAction typing to %s error, cause: %o', chatId, err);
              result.errorCount++;
            }
          });
        });

        await this.main.db.deleteChatsByIds(blockedChatIds);

        result.removedCount += blockedChatIds.length;
        offset -= blockedChatIds.length;
      }
      return result;
    });
  }
}

export default Sender;