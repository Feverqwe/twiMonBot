/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('node-index');
var Promise = require('bluebird');
var base = require('./base');
var Checker = require('./checker');
var Chat = require('./chat');
var TelegramBotApi = require('node-telegram-bot-api');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var Daemon = require('./daemon');

/**
 * @type {
 * {
 * config: {},
 * language: {
 * help: string,
 * offline: string,
 * emptyServiceList: string,
 * enterChannelName: string,
 * enterService: string,
 * serviceIsNotSupported: string,
 * channelExists: string,
 * channelAdded: string,
 * commandCanceled: string,
 * channelDontExist: string,
 * channelDeleted: string,
 * cleared: string,
 * channelNameIsEmpty: string,
 * selectDelChannel: string,
 * channelIsNotFound: string,
 * clearSure: string,
 * users: string,
 * channels: string,
 * preview: string,
 * watchOn: string,
 * online: string
 * },
 * storage: {chatList: {}, lastStreamList: Array},
 * serviceList: string[],
 * serviceToTitle: {goodgame: string, twitch: string, youtube: string, hitbox: string}}
 * }
 */
var options = {
    config: {},
    language: {},
    storage: {
        chatList: {},
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
    events: null
};

(function() {
    "use strict";
    return Promise.resolve().then(function() {
        options.events = new EventEmitter();
    }).then(function() {
        return base.loadConfig().then(function(config) {
            options.config = config;
        });
    }).then(function() {
        return base.loadLanguage().then(function(language) {
            options.language = language;
        });
    }).then(function() {
        debug('Load storage');
        return base.storage.get(Object.keys(options.storage)).then(function(storage) {
            for (var key in storage) {
                options.storage[key] = storage[key];
            }
        });
    }).then(function() {
        debug('Load services');
        return Promise.all(options.serviceList.map(function(name) {
            return Promise.resolve().then(function() {
                var service = require('./services/' + name);
                service = options.services[name] = new service(options);
                return service.onReady;
            });
        }));
    }).then(function() {
        debug('Init daemon');
        options.daemon = new Daemon(options);

        (typeof gc === 'function') && options.events.on('tickTack', function() {
            gc();
        });
    }).then(function() {
        debug('Init telegram bot api');
        /**
         * @type {{
         * sendMessage: function,
         * sendPhoto: function,
         * on: function,
         * _polling: {lastUpdate: number},
         * initPolling: function
         * }}
         */
        options.bot = new TelegramBotApi(options.config.token, {
            polling: {
                timeout: options.config.pollongTimeout || 120
            }
        });
    }).then(function() {
        debug('Init botanio');
        if (options.config.botanToken) {
            options.botan = require('botanio')(options.config.botanToken);
        } else {
            options.botan = {track: function(data, action){debug("Track %s, %j", action, data)}};
        }
    }).then(function() {
        debug('Init chat');
        options.chat = new Chat(options);
    }).then(function() {
        debug('Init checker');
        options.checker = new Checker(options);
    }).catch(function(err) {
        debug('Error', err);
    });
})();