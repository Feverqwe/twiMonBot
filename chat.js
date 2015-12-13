/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('chat');
var commands = require('./commands');

var Chat = function(options) {
    "use strict";
    this.gOptions = options;

    this.stateList = {};

    this.bindBot();

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
    this.gOptions.bot.on('message', this.onMessage.bind(this))
};

Chat.prototype.templates = {
    hideKeyboard: {
        reply_markup: JSON.stringify({
            hide_keyboard: true,
            selective: true
        })
    }
};

Chat.prototype.getServiceListKeyboard = function() {
    "use strict";
    var last = [];
    var btnList = [last];
    for (var i = 0, service; service = this.gOptions.serviceList[i]; i++) {
        if (last.length === 2) {
            last = [];
            btnList.push(last);
        }
        last.push(this.gOptions.serviceToTitle[service]);
    }
    btnList.push(['Cancel']);

    return btnList;
};

Chat.prototype.checkArgs = function(msg, args) {
    "use strict";
    var bot = this.gOptions.bot;
    var language = this.gOptions.language;
    var serviceList = this.gOptions.serviceList;

    var chatId = msg.chat.id;

    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
        bot.sendMessage(chatId, language.channelNameIsEmpty, this.templates.hideKeyboard);
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
            language.serviceIsNotSupported
                .replace('{serviceName}', service),
            this.templates.hideKeyboard
        );
        return;
    }

    args[0] = channelName;
    args[1] = service;

    return args;
};

Chat.prototype.msgParser = function(text) {
    var list = [];
    var templateList = [];
    text = text.replace(/%/g, '').replace(/\r\n\t/g, ' ');
    text = text.replace(/"([\w\s]+)"/g, function(text, value) {
        var index = templateList.push(value);
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

Chat.prototype.onMessage = function(msg) {
    "use strict";
    var _this = this;
    var text = msg.text;
    var chatId = msg.chat.id;

    var responseFunc = this.stateList[chatId];
    if (responseFunc) {
        clearTimeout(responseFunc.timeout);
        delete this.stateList[chatId];
    }

    if (text === 'Cancel') {
        text ='/cancel ' + (responseFunc && responseFunc.command || '');
    }

    if (text[0] !== '/') {
        if (responseFunc) {
            return responseFunc.call(this, msg).catch(function(err) {
                debug('Execute responseFunc "%s" error! %s', responseFunc.command, err);
            });
        }

        debug('Msg is not command! %s', text);
        return;
    }

    text = text.substr(1);

    var args = this.msgParser(text);

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

    return commandFunc.apply(this, args).catch(function(err) {
        debug('Execute command "%s" error! %s', action, err);
    }).finally(function() {
        _this.track(msg, action)
    });
};

Chat.prototype.track = function(msg, title) {
    "use strict";
    try {
        this.gOptions.botan.track({
            text: msg.text,
            from: {
                id: msg.from.id
            },
            chat: {
                id: msg.chat.id
            },
            date: msg.date
        }, title);
    } catch(e) {
        debug('Botan track error %s', e.message);
    }
};

module.exports = Chat;