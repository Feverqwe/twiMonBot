import loadConfig from "./tools/loadConfig";
import Locale from "./locale";
import Db from "./db";
import Tracker from "./tracker";
import Sender from "./sender";
import Chat from "./chat";
import Checker from "./checker";
import RateLimit from "./tools/rateLimit";
import Proxy from "./proxy";
import Goodgame from "./services/goodgame";
import Mixer from "./services/mixer";
import Twitch from "./services/twitch";
import Youtube from "./services/youtube";

process.env.NTBA_FIX_319 = true;
process.env.NTBA_FIX_350 = true;
const TelegramBot = require('node-telegram-bot-api');
const Events = require('events');
const path = require('path');
const tunnel = require('tunnel');

const debug = require('debug')('app:Main');

process.on('unhandledRejection', (err, promise) => {
  debug('unhandledRejection %o', err);
});

const config = {
  token: '',
  gaId: '',
  ytToken: '',
  twitchToken: '',
  checkChannelIfLastSyncLessThenMinutes: 5,
  channelSyncTimeoutMinutes: 5,
  emitCheckProxyEveryHours: 3,
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
  constructor() {
    super();

    this.init();
  }

  init() {
    this.config = config;
    this.locale = new Locale();
    this.db = new Db(this);

    if (process.argv.includes('--migrate')) {
      return this.db.migrate();
    }

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
        this.bot.getMe().then((user) => {
          this.botName = user.username;
          return this.bot.startPolling();
        }),
      ]);
    }).then(() => {
      debug('ready');
    }, (err) => {
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
    bot.on('polling_error', function (err) {
      debug('pollingError %s', err.message);
    });

    const limit = new RateLimit(30);
    bot.sendMessage = limit.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = limit.wrap(bot.sendPhoto.bind(bot));

    return bot;
  }
}

const main = new Main();

export default Main;