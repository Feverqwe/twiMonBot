/**
 * Created by anton on 06.12.15.
 */
var Promise = require('bluebird');
var debug = require('debug')('commands');
var base = require('./base');

var commands = {
    ping: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, "pong");
    },
    start: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help);
    },
    help: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help + _this.gOptions.language.rateMe);
    },
    a: function (msg, channelName, service) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        return _this.gOptions.services[service].getChannelName(channelName).then(function (channelName) {
            var chatItem = chatList[chatId] = chatList[chatId] || {};
            chatItem.chatId = chatId;

            var serviceList = chatItem.serviceList = chatItem.serviceList || {};
            var channelList = serviceList[service] = serviceList[service] || [];

            if (channelList.indexOf(channelName) !== -1) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelExists, _this.templates.hideKeyboard);
            }

            channelList.push(channelName);

            var title = base.getChannelTitle(_this.gOptions, service, channelName);
            var url = base.getChannelUrl(service, channelName);

            var displayName = '['+base.markDownSanitize(title, '[')+']'+'('+url+')';

            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.sendMessage(
                    chatId,
                    _this.gOptions.language.channelAdded
                        .replace('{channelName}', displayName)
                        .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                    {
                        disable_web_page_preview: true,
                        parse_mode: 'Markdown',
                        reply_markup: _this.templates.hideKeyboard.reply_markup
                    }
                );
            });
        }).catch(function(err) {
            debug('Channel "%s" (%s) is not found! %s', channelName, service, err);
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelIsNotFound
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                _this.templates.hideKeyboard
            );
        });
    },
    add: function (msg, channelName, serviceName) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        var data = [];

        var readUrl = function(url) {
            var channelName = null;
            for (var service in _this.gOptions.serviceMatchRe) {
                var reList = _this.gOptions.serviceMatchRe[service];
                if (!Array.isArray(reList)) {
                    reList = [reList];
                }
                reList.some(function(re) {
                    if (re.test(url)) {
                        channelName = url.match(re)[1];
                        return true;
                    }
                });
                if (channelName) {
                    break;
                }
            }
            return channelName && {
                channel: channelName,
                service: service
            };
        };

        if (channelName) {
            var info = readUrl(channelName);
            if (info) {
                data.push('"'+ info.channel + '"');
                data.push('"' + info.service + '"');
            } else {
                data.push('"'+ channelName + '"');
                serviceName && data.push('"' + serviceName + '"');
            }
        }

        var onTimeout = function() {
            debug("Wait message timeout, %j", msg);
            msg.text = 'Cancel';
            return _this.onMessagePromise(msg);
        };

        var waitChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg) {
                var info = readUrl(msg.text);
                if (info) {
                    data.push('"' + info.channel + '"');
                    data.push('"' + info.service + '"');

                    msg.text = '/a ' + data.join(' ');
                    return _this.onMessagePromise(msg);
                }

                data.push('"' + msg.text + '"');

                return waitServiceName();
            };
            onMessage.command = 'add';
            onMessage.timeout = setTimeout(function() {
                return onTimeout();
            }, 3 * 60 * 1000);

            var msgText = _this.gOptions.language.enterChannelName;
            if (chatId < 0) {
                msgText += _this.gOptions.language.enterChannelNameNote;
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    force_reply: true,
                    selective: true
                })
            });
        };

        var waitServiceName = function() {
            var onMessage = _this.stateList[chatId] = function(msg) {
                data.push('"' + msg.text + '"');

                msg.text = '/a ' + data.join(' ');
                return _this.onMessagePromise(msg);
            };
            onMessage.command = 'add';
            onMessage.timeout = setTimeout(function() {
                onTimeout();
            }, 3 * 60 * 1000);

            var msgText = _this.gOptions.language.enterService;
            if (chatId < 0) {
                msgText += _this.gOptions.language.selectDelChannelGroupNote;
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    keyboard: _this.getServiceListKeyboard(),
                    resize_keyboard: true,
                    one_time_keyboard: true,
                    selective: true
                })
            });
        };

        if (data.length === 0) {
            return waitChannelName();
        } else
        if (data.length === 1) {
            return waitServiceName();
        } else {
            msg.text = '/a ' + data.join(' ');
            return _this.onMessagePromise(msg);
        }
    },
    d: function (msg, channelName, service) {
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

        return base.storage.set({chatList: chatList}).then(function () {
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelDeleted
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                _this.templates.hideKeyboard
            );
        });
    },
    delete: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList, _this.templates.hideKeyboard);
        }

        var data = [];

        var responseMap = {};

        var btnList = [];
        for (var service in chatItem.serviceList) {
            var channelList = chatItem.serviceList[service];
            channelList.forEach(function(channelName) {
                var title = base.getChannelTitle(_this.gOptions, service, channelName);

                title += ' (' + _this.gOptions.serviceToTitle[service] + ')';

                var index = btnList.length + 1;
                title = index + '. ' + title;

                responseMap[index] = {name: channelName, service: service};

                btnList.push([title]);
            });
        }
        btnList.push(['Cancel']);

        var waitChannelName = function() {
            var onTimeout = function() {
                debug("Wait message timeout, %j", msg);
                msg.text = 'Cancel';
                return _this.onMessagePromise(msg);
            };

            var onMessage = _this.stateList[chatId] = function (msg) {
                var index = msg.text.match(/(\d+)/);
                index = index && index[1];

                var info = responseMap[index];
                if (!info) {
                    debug("Can't match delete channel %j", msg);
                    msg.text = '/cancel delete';
                    return _this.onMessagePromise(msg);
                }

                data.push('"' + info.name + '"');
                data.push('"' + info.service + '"');

                msg.text = '/d ' + data.join(' ');
                return _this.onMessagePromise(msg);
            };
            onMessage.command = 'delete';
            onMessage.timeout = setTimeout(function () {
                onTimeout();
            }, 3 * 60 * 1000);

            var msgText = _this.gOptions.language.selectDelChannel;
            if (chatId < 0) {
                msgText += _this.gOptions.language.selectDelChannelGroupNote;
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    keyboard: btnList,
                    resize_keyboard: true,
                    one_time_keyboard: true,
                    selective: true
                })
            });
        };

        return waitChannelName();
    },
    cancel: function (msg, arg1) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(
            chatId,
            _this.gOptions.language.commandCanceled
                .replace('{command}', arg1 || ''),
            _this.templates.hideKeyboard
        );
    },
    clear: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.clearSure);
    },
    clearyes: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        delete _this.gOptions.storage.chatList[chatId];

        return base.storage.set({chatList: _this.gOptions.storage.chatList}).then(function () {
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.cleared
            );
        });
    },
    list: function (msg) {
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
                var url = base.getChannelUrl(service, channelName);
                if (!url) {
                    debug('URL is empty!');
                    return base.markDownSanitize(channelName);
                }

                var title = base.getChannelTitle(_this.gOptions, service, channelName);

                return '[' + base.markDownSanitize(title, '[') + ']' + '(' + url + ')';
            });
            serviceList.push('*' + _this.gOptions.serviceToTitle[service] + '*' + ':\n' + channelList.join('\n'));
        }

        return _this.gOptions.bot.sendMessage(
            chatId, serviceList.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'Markdown'
            }
        );
    },
    online: function (msg) {
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
                    channelList.push(base.getStreamText(_this.gOptions, stream));
                }
            }

            channelList.length && onLineList.push(channelList.join('\n\n'));
        }

        if (!onLineList.length) {
            onLineList.unshift(_this.gOptions.language.offline);
        }

        var text = onLineList.join('\n\n');

        return _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            parse_mode: 'Markdown'
        });
    },
    top: function (msg) {
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
        lastStreamList.forEach(function (item) {
            if (item._isOffline) {
                return;
            }
            onlineCount++;
        });
        textArr.push(_this.gOptions.language.online.replace('{count}', onlineCount));

        for (service in topArr) {
            textArr.push('');
            textArr.push(_this.gOptions.serviceToTitle[service] + ':');
            topArr[service].sort(function (a, b) {
                return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1
            }).splice(10);
            topArr[service].map(function (item, index) {
                var title = base.getChannelTitle(_this.gOptions, service, item[0]);

                textArr.push((index + 1) + '. ' + title);
            });
        }

        return _this.gOptions.bot.sendMessage(chatId, textArr.join('\n'), {
            disable_web_page_preview: true
        });
    },
    livetime: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return Promise.resolve().then(function() {
            var liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));

            var endTime = liveTime.endTime.split(',');
            endTime = (new Date(endTime[0], endTime[1], endTime[2])).getTime();
            var count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;

            var message = liveTime.message.join('\n').replace('{count}', count);

            message += _this.gOptions.language.rateMe;

            return _this.gOptions.bot.sendMessage(chatId, message);
        });
    },
    refreshTitle: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var services = _this.gOptions.services;

        var queue = Promise.resolve();

        var serviceChannelList = _this.gOptions.checker.getChannelList();
        for (var service in serviceChannelList) {
            if (!serviceChannelList.hasOwnProperty(service)) {
                continue;
            }

            if (!services[service]) {
                debug('Service "%s" is not found!', service);
                continue;
            }

            if (service !== 'youtube') {
                continue;
            }

            var channelList = JSON.parse(JSON.stringify(serviceChannelList[service]));
            while (channelList.length) {
                var arr = channelList.splice(0, 100);
                (function(service, arr) {
                    queue = queue.finally(function() {
                        var promiseList = arr.map(function(userId) {
                            return services[service].getChannelName(userId);
                        });
                        return Promise.all(promiseList);
                    });
                })(service, arr);
            }
        }

        return queue.finally(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    },
    checkuseralive: function(msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        var queue = Promise.resolve();

        var chatList = _this.gOptions.storage.chatList;
        for (var _chatId in chatList) {
            var chatItem = chatList[_chatId];
            (function(chatId) {
                queue = queue.finally(function () {
                    return _this.gOptions.bot.sendChatAction(chatId, 'typing').catch(function (err) {
                        debug('Send chat action error! %s %s', chatId, err);
                        _this.gOptions.checker.onSendMsgError(err, chatId);
                    });
                });
            })(chatItem.chatId);
        }

        return queue.finally(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    }
};

commands.stop = commands.clear;

module.exports = commands;