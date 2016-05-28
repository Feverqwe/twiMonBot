/**
 * Created by Anton on 06.12.2015.
 */
var Promise = require('bluebird');
var debug = require('debug')('chat');
var commands = require('./commands');
var base = require('./base');

var Chat = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    this.stateList = {};

    this.bindBot();

    this.onMessage = (function (orig) {
        return function () {
            var args = arguments;
            return Promise.try(function() {
                return orig.apply(_this, args);
            });
        };
    })(this.onMessage);

    options.events.on('tickTack', function() {
        var bot = options.bot;
        var now = Date.now();
        var nextUpdate = bot._polling.lastUpdate + 60 * 5 * 1000;
        if (nextUpdate < Date.now()) {
            debug('Polling restart! %s < %s', nextUpdate, now);
            bot.initPolling();
        }
    });
};

Chat.prototype.bindBot = function() {
    "use strict";
    this.gOptions.bot.on('message', this.onMessage.bind(this));
    this.gOptions.bot.on('callback_query', this.onCallbackQuery.bind(this));
};

Chat.prototype.getServiceListKeyboard = function(data) {
    "use strict";
    var last = [];
    var btnList = [last];
    for (var i = 0, service; service = this.gOptions.serviceList[i]; i++) {
        if (last.length === 2) {
            last = [];
            btnList.push(last);
        }

        var _data = data.slice(0);
        _data.push('"' + service + '"');

        last.push({
            text: this.gOptions.serviceToTitle[service],
            callback_data: '/a ' + _data.join(' ')
        });
    }
    btnList.push([{
        text: 'Cancel',
        callback_data: '/c "add"'
    }]);

    return btnList;
};

Chat.prototype.checkArgs = function(msg, args, isCallbackQuery) {
    "use strict";
    var bot = this.gOptions.bot;
    var language = this.gOptions.language;
    var serviceList = this.gOptions.serviceList;

    if (isCallbackQuery) {
        msg = msg.message;
    }

    var chatId = msg.chat.id;

    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
        bot.sendMessage(chatId, language.channelNameIsEmpty);
        return;
    }

    service = service || serviceList[0];
    service = service.toLowerCase();

    if (service !== 'youtube' || !/^UC/.test(channelName)) {
        channelName = channelName.toLowerCase();
    }

    if (serviceList.indexOf(service) === -1) {
        bot.sendMessage(
            chatId,
            language.serviceIsNotSupported.replace('{serviceName}', service)
        );
        return;
    }

    args[0] = channelName;
    args[1] = service;

    return args;
};

Chat.prototype.removeBotName = function (text) {
    var botName = this.gOptions.config.botName;
    text = text.replace(/@(\w+bot)/ig, function (str, text) {
        var name = text.toLowerCase();
        if (name === botName) {
            return '';
        } else {
            return '@' + text;
        }
    });
    return text;
};

Chat.prototype.msgParser = function(text) {
    var list = [];
    var templateList = [];

    text = this.removeBotName(text);

    text = text.replace(/%/g, '').replace(/\r\n\t/g, ' ');
    text = text.replace(/"([^"]+)"/g, function(text, value) {
        var index = templateList.push(value.trim());
        return '%'+index+'%'
    });

    text.split(/\s+/).forEach(function(value) {
        if (!value) {
            return;
        }
        var index = value.match(/^%(\d+)%$/);
        if (index) {
            index = parseInt(index[1]) - 1;
            list.push(templateList[index]);
            return;
        }

        list.push(value);
    });

    return list;
};

Chat.prototype.removeChat = function(chatId) {
    "use strict";
    var chatList = this.gOptions.storage.chatList;
    var chatItem = chatList[chatId];

    if (!chatItem) {
        return Promise.resolve();
    }

    delete chatList[chatId];
    debug('Chat %s removed! %j', chatId, chatItem);

    return base.storage.set({chatList: chatList});
};

Chat.prototype.chatMigrate = function(oldChatId, newChatId) {
    "use strict";
    var chatList = this.gOptions.storage.chatList;
    var chatItem = chatList[oldChatId];

    if (!chatItem) {
        return;
    }

    delete chatList[oldChatId];
    chatList[newChatId] = chatItem;
    chatItem.chatId = newChatId;
    debug('Chat migrate from %s to %s', oldChatId, newChatId);

    return base.storage.set({chatList: chatList});
};

Chat.prototype.callbackQueryToMsg = function (callbackQuery) {
    var msg = JSON.parse(JSON.stringify(callbackQuery.message));
    msg.from = callbackQuery.from;
    msg.text = callbackQuery.data;
    return msg;
};

Chat.prototype.onCallbackQuery = function (callbackQuery) {
    "use strict";
    var _this = this;

    var data = callbackQuery.data;

    if (!data) {
        debug('Callback query data is empty! %j', callbackQuery);
        return;
    }

    if (data[0] !== '/') {
        debug('Callback query data is not command! %s', data);
        return;
    }

    data = data.substr(1);

    var args = this.msgParser(data);

    if (args.length === 0) {
        debug('Callback query args is empty! %s', data);
        return;
    }

    var action = args.shift().toLowerCase();

    if (['online', 'list', 'add', 'delete', 'top', 'livetime', 'clear', 'watch'].indexOf(action) !== -1) {
        return this.onMessage(this.callbackQueryToMsg(callbackQuery)).then(function () {
            return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id, '...');
        });
    }

    var commandFunc = commands[action + '__Cb'];
    if (!commandFunc) {
        debug('Command "%s" is not found!', action);
        return;
    }

    if (['d', 'a'].indexOf(action) !== -1) {
        args = this.checkArgs(callbackQuery, args, true);
        if (!args) {
            return;
        }
    }

    args.unshift(callbackQuery);

    var origMsg = this.callbackQueryToMsg(callbackQuery);

    return commandFunc.apply(this, args).then(function () {
        return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id, '...');
    }).catch(function(err) {
        debug('Execute callback query command "%s" error! %s', action, err);
    }).then(function() {
        _this.track(origMsg, action)
    });
};

Chat.prototype.onMessage = function(msg) {
    "use strict";
    var _this = this;
    var text = msg.text;
    var chatId = msg.chat.id;

    if (msg.migrate_from_chat_id) {
        return this.chatMigrate(msg.migrate_from_chat_id, chatId);
    }

    if (msg.migrate_to_chat_id) {
        return this.chatMigrate(chatId, msg.migrate_to_chat_id);
    }

    if (!text) {
        debug('Msg without text! %j', msg);
        return;
    }

    var responseFunc = this.stateList[chatId] || null;
    if (responseFunc && msg.from.id !== responseFunc.userId) {
        responseFunc = null;
    }

    if (responseFunc) {
        clearTimeout(responseFunc.timeout);
        delete this.stateList[chatId];
    }

    if (text[0] !== '/') {
        if (responseFunc) {
            text = this.removeBotName(msg.text);
            return responseFunc.call(this, msg, text).catch(function(err) {
                debug('Execute responseFunc "%s" error! %s', responseFunc.command, err);
            });
        }

        debug('Msg is not command! %s', text);
        return;
    }

    text = text.substr(1);

    var args = this.msgParser(text);

    if (args.length === 0) {
        debug('Msg args is empty! %s', text);
        return;
    }

    var action = args.shift().toLowerCase();
    
    var commandFunc = commands[action];
    if (!commandFunc) {
        debug('Command "%s" is not found!', action);
        return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
        args = this.checkArgs(msg, args);
        if (!args) {
            return;
        }
    }

    args.unshift(msg);

    var origMsg = JSON.parse(JSON.stringify(msg));

    return commandFunc.apply(this, args).catch(function(err) {
        debug('Execute command "%s" error! %s', action, err);
    }).then(function() {
        _this.track(origMsg, action)
    });
};

Chat.prototype.track = function(msg, title) {
    "use strict";
    return this.gOptions.tracker.track({
        text: msg.text,
        from: {
            id: msg.from.id
        },
        chat: {
            id: msg.chat.id
        },
        date: msg.date
    }, title);
};

module.exports = Chat;