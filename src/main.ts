import loadConfig from "./tools/loadConfig";
import Locale from "./locale";
import Db from "./db";
import Tracker from "./tracker";
import Sender from "./sender";
import Chat from "./chat";
import Checker, {ServiceInterface} from "./checker";
import RateLimit from "./tools/rateLimit";
import Proxy from "./proxy";
import Goodgame from "./services/goodgame";
import Mixer from "./services/mixer";
import Twitch from "./services/twitch";
import Youtube from "./services/youtube";
import ErrorWithCode from "./tools/errorWithCode";
import {TUser} from "./router";

// @ts-ignore
process.env.NTBA_FIX_319 = true;
// @ts-ignore
process.env.NTBA_FIX_350 = true;

const TelegramBot = require('node-telegram-bot-api');
const Events = require('events');
const path = require('path');
const tunnel = require('tunnel');

const debug = require('debug')('app:Main');

process.on('unhandledRejection', (err, promise) => {
  debug('unhandledRejection %o', err);
});

export interface Config {
  token: string;
  gaId: string;
  ytToken: string;
  twitchToken: string;
  emitCheckChannelsEveryMinutes: number;
  checkChannelIfLastSyncLessThenMinutes: number;
  channelSyncTimeoutMinutes: number;
  removeStreamIfOfflineMoreThanMinutes: number;
  emitCleanChatsAndChannelsEveryHours: number;
  emitSendMessagesEveryMinutes: number;
  chatSendTimeoutAfterErrorMinutes: number;
  emitCheckProxyEveryHours: number;
  defaultChannelName: string;
  db: {
    host: string;
    port: number;
    database: string;
    user: string
    password: string;
  },
  adminIds: number[];
  botProxy: null;
  proxy: {
    testUrls: (string|any)[];
    checkOnRun: boolean;
    list: (string|any)[];
  };
}

const config: Config = {
  token: '',
  gaId: '',
  ytToken: '',
  twitchToken: '',
  emitCheckChannelsEveryMinutes: 1,
  checkChannelIfLastSyncLessThenMinutes: 5,
  channelSyncTimeoutMinutes: 1,
  removeStreamIfOfflineMoreThanMinutes: 15,
  emitCleanChatsAndChannelsEveryHours: 1,
  emitSendMessagesEveryMinutes: 5,
  chatSendTimeoutAfterErrorMinutes: 1,
  emitCheckProxyEveryHours: 3,
  defaultChannelName: 'bobross',
  db: {
    host: 'localhost',
    port: 3306,
    database: 'ytWatchBot',
    user: '',
    password: ''
  },
  adminIds: [],
  botProxy: null,
  proxy: {
    testUrls: ['https://ya.ru'],
    list: [],
    checkOnRun: true
  }
};

loadConfig(path.join(__dirname, '..', 'config.json'), config);

class Main extends Events {
  config: Config;
  locale: Locale;
  db: Db;
  twitch: Twitch;
  youtube: Youtube;
  mixer: Mixer;
  goodgame: Goodgame;
  services: ServiceInterface[];
  tracker: Tracker;
  sender: Sender;
  checker: Checker;
  proxy: Proxy;
  bot: typeof TelegramBot;
  chat: Chat;
  botName: string;
  constructor() {
    super();

    this.init();
  }

  init() {
    this.config = config;
    this.locale = new Locale();
    this.db = new Db(this);

    this.twitch = new Twitch(this);
    this.youtube = new Youtube(this);
    this.mixer = new Mixer(this);
    this.goodgame = new Goodgame(this);
    this.services = [this.twitch, this.youtube, this.mixer, this.goodgame];

    this.tracker = new Tracker(this);
    this.sender = new Sender(this);
    this.checker = new Checker(this);
    this.proxy = new Proxy(this);

    this.bot = this.initBot();
    this.chat = new Chat(this);

    return this.db.init().then(() => {
      return Promise.all([
        this.checker.init(),
        this.sender.init(),
        this.bot.getMe().then((user: TUser) => {
          this.botName = user.username;
          return this.bot.startPolling();
        }),
      ]);
    }).then(() => {
      debug('ready');
    }, (err: any) => {
      debug('init error', err);
      process.exit(1);
    });
  }

  initBot() {
    let request = null;
    if (this.config.botProxy) {
      request = {
        agent: tunnel.httpsOverHttp({
          proxy: this.config.botProxy
        })
      };
    }

    const bot = new TelegramBot(this.config.token, {
      polling: {
        autoStart: false
      },
      request: request
    });
    bot.on('polling_error', function (err: any) {
      debug('pollingError %s', err.message);
    });

    const limit = new RateLimit(30);
    bot.sendMessage = limit.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = limit.wrap(bot.sendPhoto.bind(bot));

    return bot;
  }

  getServiceById(id: string) {
    const result = this.services.find(service => service.id === id);
    if (!result) {
      throw new ErrorWithCode(`Service ${id} id not found`, 'SERVICE_IS_NOT_FOUND');
    }
    return result;
  }
}

const main = new Main();

export default Main;