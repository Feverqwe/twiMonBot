import Main from "./main";
import LogFile from "./logFile";
import {everyMinutes} from "./tools/everyTime";
import getProvider from "./tools/getProvider";
import ChatSender from "./chatSender";
import arrayUniq from "./tools/arrayUniq";

const debug = require('debug')('app:Sender');
const throttle = require('lodash.throttle');

class Sender {
  main: Main;
  log: LogFile;
  constructor(main: Main) {
    this.main = main;
    this.log = new LogFile('sender');
  }

  init() {
    this.startCheckInterval();
  }

  checkTimer: Function = null;
  startCheckInterval() {
    this.checkTimer && this.checkTimer();
    this.checkTimer = everyMinutes(this.main.config.emitSendMessagesEveryMinutes, () => {
      this.check().catch((err) => {
        debug('check error', err);
      });
    });
  }

  check = () => {
    return Promise.all([
      this.main.db.getDistinctChatIdStreamIdChatIds(),
      this.main.db.getDistinctChangedMessagesChatIds(),
    ]).then((results) => {
      const chatIds = arrayUniq([].concat(...results));
      const newChatIds = chatIds.filter(chatId => !this.chatIdChatSender.has(chatId));
      return this.main.db.setChatSendTimeoutExpiresAt(newChatIds).then(() => {
        return this.main.db.getChatsByIds(newChatIds).then((chats) => {
          chats.forEach((chat) => {
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

    return chatSender.next().catch((err: any) => {
      debug('chatSender %s stopped, cause: %o', chatSender.chat.id, err);
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
}

export default Sender;