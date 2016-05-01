/**
 * Created by Anton on 06.12.2015.
 */
var Debug = require('debug');

(function () {
    var fn = Debug.formatArgs;
    Debug.formatArgs = function () {
        var self = this;
        var args = arguments;
        var useColors = this.useColors;
        var name = this.namespace;
        if (useColors) {
            return fn.apply(self, args);
        } else {
            args[0] = new Date().toString()
                + ' ' + name + ' ' + args[0];
        }
        return args;
    };
})();

var debug = Debug('index');
var debugLog = Debug('index:log');
debugLog.log = console.log.bind(console);
var Promise = require('bluebird');
var base = require('./base');
var Checker = require('./checker');
var Chat = require('./chat');
var TelegramBotApi = require('node-telegram-bot-api');
var EventEmitter = require('events').EventEmitter;
var Daemon = require('./daemon');
var Tracker = require('./tracker');
var LiveController = require('./liveController');

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
 * online: string,
 * rateMe: string,
 * enterChannelNameNote: string,
 * selectDelChannelGroupNote: string
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
    serviceMatchRe: {
        goodgame: /goodgame\.ru\/channel\/([^\/]+)/i,
        twitch: /twitch\.tv\/([^\/]+)/i,
        youtube: [
            /youtube\.com\/(?:#\/)?(?:user|channel)\/([0-9A-Za-z_-]+)/i,
            /youtube\.com\/([0-9A-Za-z_-]+)$/i
        ],
        hitbox: /hitbox\.tv\/([^\/]+)/i
    },
    services: {},
    events: null,
    tracker: null
};

(function() {
    "use strict";
    return Promise.resolve().then(function() {
        options.events = new EventEmitter();
    }).then(function() {
        return base.loadConfig().then(function(config) {
            options.config = config;

            config.botName && (config.botName = config.botName.toLowerCase());
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
        // todo: rm after update
        var origProcessUpdate = TelegramBotApi.prototype._processUpdate;
        TelegramBotApi.prototype.answerCallbackQuery = function (queryId, text, options) {
            var form = options || {};
            form.callback_query_id = queryId;
            return this._request('answerCallbackQuery', {form: form});
        };
        TelegramBotApi.prototype.editMessageReplyMarkup = function (chatId, options) {
            var form = options || {};
            form.chat_id = chatId;
            return this._request('editMessageReplyMarkup', {form: form});
        };
        TelegramBotApi.prototype.editMessageText = function (chatId, text, options) {
            var form = options || {};
            form.chat_id = chatId;
            form.text = text;
            return this._request('editMessageText', {form: form});
        };
        TelegramBotApi.prototype._processUpdate = function (update) {
            var callbackQuery = update.callback_query;
            if (callbackQuery) {
                this.emit('callback_query', callbackQuery);
            }
            origProcessUpdate.call(this, update);
        };
        
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

        var quote = new base.Quote(30);

        options.bot.sendMessage = quote.wrapper(options.bot.sendMessage.bind(options.bot));
        options.bot.sendPhoto = quote.wrapper(options.bot.sendPhoto.bind(options.bot));
        options.bot.sendChatAction = quote.wrapper(options.bot.sendChatAction.bind(options.bot));
        options.bot.editMessageText = quote.wrapper(options.bot.editMessageText.bind(options.bot));
        options.bot.editMessageReplyMarkup = quote.wrapper(options.bot.editMessageReplyMarkup.bind(options.bot));
        options.bot.answerCallbackQuery = quote.wrapper(options.bot.answerCallbackQuery.bind(options.bot));
    }).then(function() {
        options.tracker = new Tracker(options);
    }).then(function() {
        options.chat = new Chat(options);
    }).then(function() {
        options.liveController = new LiveController(options);
    }).then(function() {
        options.checker = new Checker(options);
    }).catch(function(err) {
        debug('Loading error %s', err);
    });
})();