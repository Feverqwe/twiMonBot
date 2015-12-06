/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('node-index');
var Promise = require('bluebird');
var base = require('./base');
var Checker = require('./checker');
var Chat = require('./chat');
var TelegramBotApi = require('node-telegram-bot-api');

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
    services: {}
};

(function() {
    "use strict";
    return Promise.resolve().then(function() {
        return base.loadConfig().then(function(config) {
            options.config = config;
        });
    }).then(function() {
        return base.loadLanguage().then(function(language) {
            options.language = language;
        });
    }).then(function() {
        return base.storage.get(Object.keys(options.storage)).then(function(storage) {
            for (var key in storage) {
                options.storage[key] = storage[key];
            }
        });
    }).then(function() {
        options.serviceList.forEach(function(name) {
            options.services[name] = new require('./services/' + name)(options);
        });
    }).then(function() {
        debug('Init telegram bot api');
        /**
         * @type {{
         * sendMessage: function,
         * sendPhoto: function,
         * on: function
         * }}
         */
        options.bot = new TelegramBotApi(options.config.token, {
            polling: {
                timeout: 120
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