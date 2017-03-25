/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:index');
var base = require('./base');
var Checker = require('./checker');
var Chat = require('./chat');
const TelegramBot = require('node-telegram-bot-api');
var EventEmitter = require('events').EventEmitter;
var Daemon = require('./daemon');
var Tracker = require('./tracker');
var LiveController = require('./liveController');
var MsgStack = require('./msgStack');
var MsgSender = require('./msgSender');
const Db = require('./db');
const Locale = require('./locale');
const Users = require('./users');

var options = {
    config: {},
    language: {},
    storage: {
        lastStreamList: []
    },
    serviceList: ['twitch', 'goodgame', 'youtube', 'hitbox'],
    serviceToTitle: {
        goodgame: 'GoodGame',
        twitch: 'Twitch',
        youtube: 'Youtube',
        hitbox: 'Hitbox'
    },
    services: {},
    events: null,
    tracker: null,
    db: null,
    users: null
};

(function() {
    options.events = new EventEmitter();
    return Promise.all([
        base.loadConfig().then(function(config) {
            options.config = config;

            config.botName && (config.botName = config.botName.toLowerCase());
        })
    ]).then(function() {
        options.locale = new Locale(options);
        return options.locale.onReady.then(function () {
            options.language = options.locale.language;
        });
    }).then(function() {
        options.db = new Db(options);
        return options.db.onReady;
    }).then(function() {
        options.users = new Users(options);
        return options.users.onReady;
    }).then(function() {
        return base.storage.get(Object.keys(options.storage)).then(function(storage) {
            for (var key in storage) {
                options.storage[key] = storage[key];
            }
        });
    }).then(function() {
        return Promise.all(options.serviceList.map(function(name) {
            return Promise.resolve().then(function() {
                var service = require('./services/' + name);
                service = options.services[name] = new service(options);
                return service.onReady;
            });
        }));
    }).then(function() {
        options.daemon = new Daemon(options);

        (typeof gc === 'function') && options.events.on('tickTack', function() {
            gc();
        });
    }).then(function() {
        options.bot = new TelegramBot(options.config.token, {
            polling: true
        });
        options.bot.on('polling_error', function (err) {
            debug('pollingError %o', err);
        });

        var quote = new base.Quote(30);
        options.bot.sendMessage = quote.wrapper(options.bot.sendMessage, options.bot);
        options.bot.sendPhotoQuote = quote.wrapper(options.bot.sendPhoto, options.bot);
    }).then(function() {
        options.tracker = new Tracker(options);
    }).then(function() {
        options.msgStack = new MsgStack(options);

        return options.msgStack.onReady;
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