/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:index');
const base = require('./base');
const Checker = require('./checker');
const Chat = require('./chat');
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

const options = {
    events: null,
    config: null,
    locale: null,
    language: null,
    db: null,
    channels: null,
    users: null,
    msgStack: null,
    services: {},
    serviceList: ['twitch', 'goodgame', 'youtube', 'smashcast', 'beam'],
    serviceToTitle: {
        goodgame: 'GoodGame',
        twitch: 'Twitch',
        youtube: 'Youtube',
        beam: 'Beam',
        smashcast: 'Smashcast'
    },
    daemon: null,
    bot: null,
    tracker: null,
    msgSender: null,
    chat: null,
    liveController: null,
    checker: null
};

(function() {
    return Promise.resolve().then(function () {
        options.events = new EventEmitter();

        return base.loadConfig().then(function(config) {
            config.botName && (config.botName = config.botName.toLowerCase());

            options.config = config;
        });
    }).then(function() {
        options.locale = new Locale(options);

        return options.locale.onReady.then(function () {
            options.language = options.locale.language;
        });
    }).then(function() {
        options.db = new Db(options);

        return options.db.onReady;
    }).then(function() {
        options.channels = new Channels(options);

        return options.channels.onReady;
    }).then(function() {
        return Promise.all(options.serviceList.map(function(name) {
            var service = require('./services/' + name);
            service = options.services[name] = new service(options);

            return service.onReady;
        }));
    }).then(function() {
        options.users = new Users(options);

        return options.users.onReady;
    }).then(function() {
        options.msgStack = new MsgStack(options);

        return options.msgStack.onReady;
    }).then(function() {
        options.daemon = new Daemon(options);
    }).then(function() {
        options.bot = new TelegramBot(options.config.token, {
            polling: true
        });
        options.bot.on('polling_error', function (err) {
            debug('pollingError', err.message);
        });

        var quote = new base.Quote(30);
        options.bot.sendMessage = quote.wrapper(options.bot.sendMessage, options.bot);
        options.bot.sendPhotoQuote = quote.wrapper(options.bot.sendPhoto, options.bot);
    }).then(function() {
        options.tracker = new Tracker(options);
    }).then(function() {
        options.msgSender = new MsgSender(options);
    }).then(function() {
        options.chat = new Chat(options);
    }).then(function() {
        options.liveController = new LiveController(options);
    }).then(function() {
        options.checker = new Checker(options);
    }).catch(function(err) {
        debug('Loading error', err);
    });
})();