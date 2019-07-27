/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:index');
const base = require('./base');
const Checker = require('./checker');
const Chat = require('./chat');
const Quote = require('./tools/quote');
const bluebird = require('bluebird');
bluebird.config({
    cancellation: true,
});
process.env.NTBA_FIX_319 = true;
const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const Daemon = require('./daemon');
const Tracker = require('./tracker');
const LiveController = require('./liveController');
const MsgStack = require('./msgStack');
const MsgSender = require('./msgSender');
const Users = require('./users');
const Db = require('./db');
const Locale = require('./locale');
const Channels = require('./channels');
const BotMessages = require('./botMessages');
const ProxyList = require('./proxyList');

const config = {
    token: '',
    interval: 5,
    timeout: 900,
    gaId: '',
    ytToken: '',
    twitchToken: '',
    checkOnRun: false,
    botName: 'twiMonBot',
    db: {
        host: 'localhost',
        port: 3306,
        database: 'twiMonBot',
        user: '',
        password: ''
    },
    adminIds: [],
    proxyCheckOnRun: true,
    proxyCheckInterval: 10800,
    proxyList: null
};

class Main {
    constructor() {
        this.events = new EventEmitter();
        this.config = config;
        this.locale = null;
        this.language = null;
        this.db = null;
        this.channels = null;
        this.users = null;
        this.msgStack = null;
        this.services = {};
        this.serviceList = ['twitch', 'goodgame', 'youtube', 'mixer'];
        this.serviceToTitle = {
            goodgame: 'GoodGame',
            twitch: 'Twitch',
            youtube: 'Youtube',
            mixer: 'Mixer',
        };
        this.daemon = null;
        this.bot = null;
        this.tracker = null;
        this.msgSender = null;
        this.botMessages = null;
        this.chat = null;
        this.liveController = null;
        this.checker = null;
        this.proxyList = null;

        this.init();
    }

    async init() {
        this.initConfig();

        const locale = this.locale = new Locale(this);
        this.language = locale.language;
        await locale.onReady;

        const db = this.db = new Db(this);
        await db.onReady;

        const channels = this.channels = new Channels(this);
        await channels.onReady;

        await Promise.all(this.serviceList.map((name) => {
            const Service = require('./services/' + name);
            const service = this.services[name] = new Service(this);
            return service.onReady;
        }));

        const users = this.users = new Users(this);
        await users.onReady;

        const msgStack = this.msgStack = new MsgStack(this);
        await msgStack.onReady;

        const botMessages = this.botMessages = new BotMessages(this);
        await botMessages.onReady;

        this.daemon = new Daemon(this);

        this.initBot();

        this.tracker = new Tracker(this);
        this.msgSender = new MsgSender(this);
        this.chat = new Chat(this);
        this.liveController = new LiveController(this);
        this.checker = new Checker(this);
        this.proxyList = new ProxyList(this);
    }

    initConfig() {
        const config = base.loadConfig();
        if (config.botName) {
            config.botName = config.botName.toLowerCase();
        }
        this.config = config;
    }

    initBot() {
        const bot = this.bot = new TelegramBot(this.config.token, {
            polling: true
        });
        bot.on('polling_error', function (err) {
            debug('pollingError %o', err.message);
        });

        const quote = new Quote(30);
        bot.sendMessage = quote.wrap(bot.sendMessage.bind(bot));
        bot.sendPhotoQuote = quote.wrap(bot.sendPhoto.bind(bot));
    }
}

module.exports = new Main();