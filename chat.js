/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('node-chat');
var base = require('./base');

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

    if (service !== 'youtube' || channelName.substr(0, 2) !== 'UC') {
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

Chat.prototype.getArgs = function(text) {
    "use strict";
    return text.split(/\s+/);
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

    var args = this.getArgs(text);

    var action = args.shift().toLowerCase();
    var func = this.actionList[action];

    if (!func) {
        debug("Command is not found!", action);
        return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
        args = this.checkArgs(msg, args);
    }

    if (!args) {
        debug("Args is empty!");
        return;
    }

    debug("Run action", action, args);

    args.unshift(msg);

    func.apply(this, args);

    this.track(msg, action)
};

Chat.prototype.actionList = {
    ping: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.gOptions.bot.sendMessage(chatId, "pong");
    },
    start: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help);
    },
    help: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help);
    },
    a: function(msg, channelName, service) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        this.gOptions.services[service].getChannelName(channelName, function(_channelName, channelId) {
            if (!_channelName) {
                return _this.gOptions.bot.sendMessage(
                    chatId,
                    _this.gOptions.language.channelIsNotFound
                        .replace('{channelName}', channelName)
                        .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                    _this.templates.hideKeyboard
                );
            }
            channelName = _channelName;

            var chatItem = chatList[chatId] = chatList[chatId] || {};
            chatItem.chatId = chatId;

            var serviceList = chatItem.serviceList = chatItem.serviceList || {};
            var channelList = serviceList[service] = serviceList[service] || [];

            if (channelList.indexOf(channelName) !== -1) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelExists, _this.templates.hideKeyboard);
            }

            channelList.push(channelName);

            var displayName = [channelName];
            if (channelId) {
                displayName.push('(' + channelId + ')');
            }

            base.storage.set({chatList: chatList}).then(function() {
                return _this.gOptions.bot.sendMessage(
                    chatId,
                    _this.gOptions.language.channelAdded
                        .replace('{channelName}', displayName.join(' '))
                        .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                    _this.templates.hideKeyboard
                );
            });
        });
    },
    add: function(msg, channelName, serviceName) {
        "use strict";
        var _this = this;

        var data = [];
        channelName && data.push(channelName);
        channelName && serviceName && data.push(serviceName);

        if (data.length === 0) {
            _this.sceneList.waitChannelName(data, msg);
        } else
        if (data.length === 1) {
            _this.sceneList.waitServiceName(data, msg);
        } else {
            msg.text = '/a ' + data.join(' ');
            _this.onMessage(msg);
        }
    },
    d: function(msg, channelName, service) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[service];

        if (!channelList) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList, _this.templates.hideKeyboard);
        }

        var pos = channelList.indexOf(channelName);
        if (pos === -1) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelDontExist, _this.templates.hideKeyboard);
        }

        channelList.splice(pos, 1);

        if (channelList.length === 0) {
            delete chatItem.serviceList[service];

            if (Object.keys(chatItem.serviceList).length === 0) {
                delete chatList[chatId];
            }
        }

        base.storage.set({chatList: chatList}).then(function() {
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelDeleted
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                _this.templates.hideKeyboard
            );
        });
    },
    delete: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList, _this.templates.hideKeyboard);
        }

        _this.stateList[chatId] = function(msg) {
            var data = msg.text.match(/^(.+) \((.+)\)$/);
            if (!data) {
                debug("Can't match delete channel");
                return;
            }
            data.shift();

            msg.text = '/d ' + data.join(' ');
            _this.onMessage(msg);
        };
        _this.stateList[chatId].command = 'delete';
        _this.stateList[chatId].now = Date.now();

        var btnList = [];
        for (var service in chatItem.serviceList) {
            var channelList = chatItem.serviceList[service];
            for (var i = 0, channelName; channelName = channelList[i]; i++) {
                btnList.push([channelName + ' (' + _this.gOptions.serviceToTitle[service] + ')']);
            }
        }
        btnList.push(['Cancel']);

        _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.selectDelChannel, {
            reply_markup: JSON.stringify({
                keyboard: btnList,
                resize_keyboard: true,
                one_time_keyboard: true,
                selective: true
            })
        });
    },
    cancel: function(msg, arg1) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        _this.gOptions.bot.sendMessage(
            chatId,
            _this.gOptions.language.commandCanceled
                .replace('{command}', arg1 || ''),
            _this.templates.hideKeyboard
        );
    },
    clear: function(msg, isYes) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        if (!isYes) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.clearSure);
        }

        if (isYes !== 'yes') {
            return;
        }

        delete _this.gOptions.storage.chatList[chatId];

        base.storage.set({chatList: _this.gOptions.storage.chatList}).then(function() {
            _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.cleared
            );
        });
    },
    list: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var serviceList = [];

        for (var service in chatItem.serviceList) {
            var channelList = chatItem.serviceList[service].map(function(channelName) {
                return base.markDownSanitize(channelName);
            });
            serviceList.push('*' + _this.gOptions.serviceToTitle[service] + '*' + ': ' + channelList.join(', '));
        }

        _this.gOptions.bot.sendMessage(
            chatId, serviceList.join('\n\n'), {
                parse_mode: 'Markdown'
            }
        );
    },
    online: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var onLineList = [];
        var lastStreamList = _this.gOptions.storage.lastStreamList;

        for (var service in chatItem.serviceList) {
            var userChannelList = chatItem.serviceList[service];

            var channelList = [];

            for (var i = 0, stream; stream = lastStreamList[i]; i++) {
                if (stream._isOffline || stream._service !== service) {
                    continue;
                }

                if (userChannelList.indexOf(stream._channelName) !== -1) {
                    channelList.push(_this.getStreamText(stream));
                }
            }

            channelList.length && onLineList.push(channelList.join('\n\n'));
        }

        if (!onLineList.length) {
            onLineList.unshift(_this.gOptions.language.offline);
        }

        var text = onLineList.join('\n\n');

        _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            parse_mode: 'Markdown'
        });
    },
    top: function(msg) {
        "use strict";
        var service, channelList, channelName;
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        var userCount = 0;
        var channelCount = 0;

        var top = {};
        for (var _chatId in chatList) {
            var chatItem = chatList[_chatId];
            if (!chatItem.serviceList) {
                continue;
            }

            userCount++;

            for (var n = 0; service = _this.gOptions.serviceList[n]; n++) {
                var userChannelList = chatItem.serviceList[service];
                if (!userChannelList) {
                    continue;
                }

                channelList = top[service];
                if (channelList === undefined) {
                    channelList = top[service] = {};
                }

                for (var i = 0; channelName = userChannelList[i]; i++) {
                    if (channelList[channelName] === undefined) {
                        channelList[channelName] = 0;
                    }
                    channelList[channelName]++;
                }
            }
        }

        var topArr = {};
        for (service in top) {
            channelList = top[service];

            channelCount += Object.keys(channelList).length;

            if (!topArr[service]) {
                topArr[service] = [];
            }

            for (channelName in channelList) {
                var count = channelList[channelName];
                topArr[service].push([channelName, count]);
            }
        }

        var textArr = [];

        textArr.push(_this.gOptions.language.users.replace('{count}', userCount));
        textArr.push(_this.gOptions.language.channels.replace('{count}', channelCount));

        var onlineCount = 0;
        var lastStreamList = _this.gOptions.storage.lastStreamList;
        lastStreamList.forEach(function(item) {
            if (item._isOffline) {
                return;
            }
            onlineCount++;
        });
        textArr.push(_this.gOptions.language.online.replace('{count}', onlineCount));

        for (service in topArr) {
            textArr.push('');
            textArr.push(_this.gOptions.serviceToTitle[service] + ':');
            topArr[service].sort(function(a, b){return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1}).splice(10);
            topArr[service].map(function(item, index) {
                textArr.push((index + 1) + '. ' + item[0]);
            });
        }

        _this.gOptions.bot.sendMessage(chatId, textArr.join('\n'));
    },
    livetime: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        var liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));

        var endTime = liveTime.endTime.split(',');
        endTime = (new Date(endTime[0], endTime[1], endTime[2])).getTime();
        var count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;

        var message = liveTime.message.join('\n').replace('{count}', count);

        _this.gOptions.bot.sendMessage(chatId, message);
    }
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
        console.error(utils.getDate(), 'Botan track error', e.message);
    }
};

module.exports = Chat;