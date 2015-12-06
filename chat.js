/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('node-chat');
var base = require('./base');
var commands = require('./commands');

var Chat = function(options) {
    "use strict";
    this.gOptions = options;

    this.stateList = {};

    this.bindBot();

    options.events.on('tickTack', function() {
        var bot = options.bot;
        if (bot._polling.lastUpdate + 60 * 5 * 1000 < Date.now()) {
            debug(base.getDate(), 'Polling restart!');
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

Chat.prototype.clearStateList = function() {
    "use strict";
    var chatId, i;
    var aliveTime = Date.now() - 5 * 60 * 1000;
    var rmList = [];
    var stateList = this.stateList;
    for (chatId in stateList) {
        var func = stateList[chatId];
        if (func.now < aliveTime) {
            rmList.push(chatId);
        }
    }
    for (i = 0, chatId; chatId = rmList[i]; i++) {
        delete stateList[chatId];
    }
};

Chat.prototype.sceneList = {
    waitChannelName: function(data, msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.stateList[chatId] = function(msg) {
            data.push(msg.text);

            _this.sceneList.waitServiceName(data, msg);
        };
        _this.stateList[chatId].command = 'add';
        _this.stateList[chatId].now = Date.now();

        _this.bot.sendMessage(
            chatId,
            _this.language.enterChannelName
        );
    },
    waitServiceName: function(data, msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.stateList[chatId] = function(msg) {
            "use strict";
            data.push(msg.text);
            msg.text = '/a ' + data.join(' ');
            _this.onMessage(msg);
        };
        _this.stateList[chatId].command = 'add';
        _this.stateList[chatId].now = Date.now();

        _this.bot.sendMessage(chatId, _this.language.enterService, {
            reply_markup: JSON.stringify({
                keyboard: _this.getServiceListKeyboard(),
                resize_keyboard: true,
                one_time_keyboard: true,
                selective: true
            })
        });
    }
};

/**
 * @param {{
 * channel: {display_name},
 * viewers,
 * game,
 * _service,
 * preview,
 * _isOffline,
 * _channelName
 * }} stream
 * @returns {string}
 */
Chat.prototype.getStreamText = function(stream) {
    var textArr = [];

    textArr.push('*' + base.markDownSanitize(stream.channel.display_name || stream.channel.name) + '*');

    var line = [];
    if (stream.viewers || stream.viewers === 0) {
        line.push(stream.viewers);
    }
    if (stream.channel.status) {
        line.push(base.markDownSanitize(stream.channel.status));
    }
    if (stream.game) {
        line.push('_' + base.markDownSanitize(stream.game) + '_');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (stream.channel.url) {
        line.push(this.gOptions.language.watchOn
            .replace('{channelName} ', '')
            .replace('{serviceName}', '['+this.gOptions.serviceToTitle[stream._service]+']'+'('+stream.channel.url+')')
        );
    }
    if (stream.preview) {
        line.push('['+this.gOptions.language.preview+']' + '('+stream.preview+')');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
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

    if (service !== 'youtube' || /^UC/.test(channelName)) {
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
    debug('Input msg, %j', msg);

    var text = msg.text;
    var chatId = msg.chat.id;

    var responseFunc = this.stateList[chatId];
    if (responseFunc) {
        debug("Has response function!");
        delete this.stateList[chatId];
    }

    if (!text) {
        debug("Text is empty!");
        return;
    }

    if (text === 'Cancel') {
        text ='/cancel ' + (responseFunc && responseFunc.command || '');
    }

    if (text[0] !== '/') {
        if (responseFunc) {
            return responseFunc.call(this, msg);
        }

        debug("Msg is not command!", text);
        return;
    }

    text = text.substr(1);

    var args = this.msgParser(text);

    var action = args.shift().toLowerCase();
    var func = commands[action];

    if (!func) {
        debug("Command is not found!", action);
        return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
        args = this.checkArgs(msg, args);

        if (!args) {
            debug("Args is empty!");
            return;
        }
    }

    debug("Run action", action, args);

    args.unshift(msg);

    func.apply(this, args);

    this.track(msg, action)
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
        debug(base.getDate(), 'Botan track error', e.message);
    }
};

module.exports = Chat;