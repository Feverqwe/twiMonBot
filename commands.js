/**
 * Created by anton on 06.12.15.
 */
var Promise = require('bluebird');
var debug = require('debug')('commands');
var base = require('./base');

var menuBtnList = function (page) {
    var btnList = null;
    if (page === 1) {
        btnList = [
            [
                {
                    text: 'Options',
                    callback_data: '/options'
                }
            ],
            [
                {
                    text: '<',
                    callback_data: '/menu_page 0'
                },
                {
                    text: 'Top 10',
                    callback_data: '/top'
                },
                {
                    text: 'How long will it works',
                    callback_data: '/liveTime'
                }
            ]
        ];
    } else {
        btnList = [
            [
                {
                    text: 'Online',
                    callback_data: '/online'
                },
                {
                    text: 'Show the channel list',
                    callback_data: '/list'
                }
            ],
            [
                {
                    text: 'Add channel',
                    callback_data: '/add'
                },
                {
                    text: 'Delete channel',
                    callback_data: '/delete'
                },
                {
                    text: '>',
                    callback_data: '/menu_page 1'
                }
            ]
        ];
    }

    return btnList;
};

var optionsBtnList = function (chatItem) {
    var options = chatItem.options || {};

    var btnList = [];

    if (options.hidePreview) {
        btnList.push([{
            text: 'Show preview',
            callback_data: '/option hidePreview 0'
        }]);
    } else {
        btnList.push([{
            text: 'Hide preview',
            callback_data: '/option hidePreview 1'
        }]);
    }

    if (options.channel) {
        btnList.push([{
            text: 'Remove channel (' + options.channel + ')',
            callback_data: '/setchannel remove'
        }]);
    } else {
        btnList.push([{
            text: 'Set channel',
            callback_data: '/setchannel'
        }]);
    }

    if (options.channel) {
        if (options.mute) {
            btnList.push([{
                text: 'Unmute',
                callback_data: '/option mute 0'
            }]);
        } else {
            btnList.push([{
                text: 'Mute',
                callback_data: '/option mute 1'
            }]);
        }
    }

    return btnList;
};

/**
 * @param {Object} chatItem
 * @param {number} page
 * @returns {Array.<*>}
 */
var getDeleteChannelList = function (chatItem, page) {
    var _this = this;
    page = parseInt(page || 0);
    var btnList = [];

    Object.keys(chatItem.serviceList).forEach(function (service) {
        var channelList = chatItem.serviceList[service];
        channelList.forEach(function(channelName) {
            var btnItem = {};

            var title = base.getChannelTitle(_this.gOptions, service, channelName);
            title += ' (' + _this.gOptions.serviceToTitle[service] + ')';
            btnItem.text = title;

            btnItem.callback_data = '/d "' + channelName + '" "' + service + '"';

            btnList.push([btnItem]);
        });
    });

    var maxItemCount = 10;
    var offset = page * maxItemCount;
    var offsetEnd = offset + maxItemCount;
    var countItem = btnList.length;
    var pageList = btnList.slice(offset, offsetEnd);
    if (countItem > maxItemCount) {
        var pageControls = [];
        if (page > 0) {
            pageControls.push({
                text: '<',
                callback_data: '/delete_upd ' + (page - 1)
            });
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: '/delete_upd ' + (page + 1)
            });
        }
        pageList.push(pageControls);
    }

    return pageList;
};

var setOption = function (chatItem, optionName, state) {
    if (['hidePreview', 'mute'].indexOf(optionName) === -1) {
        debug('Option is not found! %s', optionName);
        return Promise.reject(new Error('Option is not found!'));
    }

    var options = base.getObjectItemOrObj(chatItem, 'options');
    options[optionName] = state === '1';
    if (!options[optionName]) {
        delete options[optionName];
    }

    if (!Object.keys(options).length) {
        delete chatItem.options;
    }

    var msgText = 'Option ' + optionName + ' (' + state + ') changed!';

    return Promise.resolve(msgText);
};

var getOnlineChannelList = function (chatItem, skipOffline) {
    var lastStreamList = this.gOptions.storage.lastStreamList;
    var serviceList = {};
    for (var service in chatItem.serviceList) {
        var userChannelList = chatItem.serviceList[service];

        var channelList = serviceList[service];
        if (!channelList) {
            channelList = serviceList[service] = {};
        }

        for (var i = 0, stream; stream = lastStreamList[i]; i++) {
            if (stream._service !== service) {
                continue;
            }
            if (skipOffline && stream._isOffline) {
                continue;
            }

            var streamList = channelList[stream._channelId];
            if (!streamList) {
                streamList = channelList[stream._channelId] = [];
            }

            if (userChannelList.indexOf(stream._channelId) !== -1) {
                streamList.push(stream);
            }
        }
    }
    return serviceList;
};

var getOnlineText = function (chatItem) {
    "use strict";
    var _this = this;
    var onlineList = [];

    var serviceList = getOnlineChannelList.call(this, chatItem);
    Object.keys(serviceList).forEach(function (service) {
        var channelList = serviceList[service];

        var textChannelList = [];

        Object.keys(channelList).forEach(function (channelId) {
            var streamList = channelList[channelId];
            streamList.forEach(function (stream) {
                textChannelList.push(base.getStreamText(_this.gOptions, stream));
            });
        });

        textChannelList.length && onlineList.push(textChannelList.join('\n\n'));
    });

    if (!onlineList.length) {
        onlineList.unshift(_this.gOptions.language.offline);
    }

    return onlineList.join('\n\n');
};

var getWatchBtnList = function (chatItem) {
    "use strict";
    var _this = this;
    var btnList = [];

    var serviceList = getOnlineChannelList.call(this, chatItem);
    Object.keys(serviceList).forEach(function (service) {
        var channelList = serviceList[service];

        Object.keys(channelList).forEach(function (channelId) {
            var streamList = channelList[channelId];
            if (!streamList.length) {
                return;
            }

            var title = base.getChannelTitle(_this.gOptions, service, channelId);
            var text = title + ' (' + _this.gOptions.serviceToTitle[service] + ')';

            btnList.push([{
                text: text,
                callback_data: '/watch ' + channelId + ' ' + service
            }]);
        });
    });

    return btnList;
};

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

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help, {
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    menu_page__Cb: function (callbackQuery, page) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        page = parseInt(page);

        return _this.gOptions.bot.editMessageReplyMarkup(
            chatId,
            {
                message_id: msg.message_id,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(page)
                })
            }
        );
    },
    help: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        var text = _this.gOptions.language.help;
        if (base.getRandomInt(0, 100) < 30) {
            text += _this.gOptions.language.rateMe;
        }

        return _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    a__Cb: function (callbackQuery, channelName, service) {
        "use strict";
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        return _this.gOptions.services[service].getChannelId(channelName).then(function (channelId) {
            var chatItem = chatList[chatId] = chatList[chatId] || {};
            chatItem.chatId = chatId;

            var serviceList = chatItem.serviceList = chatItem.serviceList || {};
            var channelList = serviceList[service] = serviceList[service] || [];

            if (channelList.indexOf(channelId) !== -1) {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.channelExists,
                    {
                        message_id: msg.message_id
                    });
            }

            channelList.push(channelId);

            var title = base.getChannelTitle(_this.gOptions, service, channelId);
            var url = base.getChannelUrl(service, channelId);

            var displayName = base.htmlSanitize('a', title, url);

            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.channelAdded
                        .replace('{channelName}', displayName)
                        .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                    {
                        message_id: msg.message_id,
                        disable_web_page_preview: true,
                        parse_mode: 'HTML'
                    }
                ).then(function () {
                    var onlineServiceList = getOnlineChannelList.call(_this, chatItem);
                    var channelList = onlineServiceList[service] || {};
                    var streamList = channelList[channelId] || [];
                    streamList.forEach(function (stream) {
                        var text = base.getNowStreamPhotoText(_this.gOptions, stream);
                        var noPhotoText = base.getNowStreamText(_this.gOptions, stream);
                        return _this.gOptions.checker.sendNotify([chatId], text, noPhotoText, stream, true).catch(function (err) {
                            debug('a commend, sendNotify error! %s', err);
                        });
                    });
                });
            });
        }).catch(function(err) {
            debug('Channel "%s" (%s) is not found! %s', channelName, service, err);
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.channelIsNotFound
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                {
                    message_id: msg.message_id
                }
            );
        });
    },
    a: function (msg, channelName, service) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        return _this.gOptions.services[service].getChannelId(channelName).then(function (channelId) {
            var chatItem = chatList[chatId] = chatList[chatId] || {};
            chatItem.chatId = chatId;

            var serviceList = chatItem.serviceList = chatItem.serviceList || {};
            var channelList = serviceList[service] = serviceList[service] || [];

            if (channelList.indexOf(channelId) !== -1) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelExists);
            }

            channelList.push(channelId);

            var title = base.getChannelTitle(_this.gOptions, service, channelId);
            var url = base.getChannelUrl(service, channelId);

            var displayName = base.htmlSanitize('a', title, url);

            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.sendMessage(
                    chatId,
                    _this.gOptions.language.channelAdded
                        .replace('{channelName}', displayName)
                        .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                    {
                        disable_web_page_preview: true,
                        parse_mode: 'HTML'
                    }
                ).then(function () {
                    var onlineServiceList = getOnlineChannelList.call(_this, chatItem);
                    var channelList = onlineServiceList[service] || {};
                    var streamList = channelList[channelId] || [];
                    streamList.forEach(function (stream) {
                        var text = base.getNowStreamPhotoText(_this.gOptions, stream);
                        var noPhotoText = base.getNowStreamText(_this.gOptions, stream);
                        return _this.gOptions.checker.sendNotify([chatId], text, noPhotoText, stream, true).catch(function (err) {
                            debug('a commend, sendNotify error! %s', err);
                        });
                    });
                });
            });
        }).catch(function(err) {
            debug('Channel "%s" (%s) is not found! %s', channelName, service, err);
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelIsNotFound
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service])
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
            msg.text = '/cancel add';
            return _this.onMessage(msg);
        };

        var waitChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg, text) {
                var info = readUrl(text);
                if (info) {
                    data.push('"' + info.channel + '"');
                    data.push('"' + info.service + '"');

                    msg.text = '/a ' + data.join(' ');
                    return _this.onMessage(msg);
                }

                data.push('"' + text + '"');

                return waitServiceName();
            };
            onMessage.command = 'add';
            onMessage.userId = msg.from.id;
            onMessage.timeout = setTimeout(function() {
                return onTimeout();
            }, 3 * 60 * 1000);

            var msgText = _this.gOptions.language.enterChannelName;
            if (chatId < 0) {
                msgText += _this.gOptions.language.groupNote;
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    force_reply: true
                })
            });
        };

        var waitServiceName = function() {
            var msgText = _this.gOptions.language.enterService;

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    inline_keyboard: _this.getServiceListKeyboard(data)
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
            return _this.onMessage(msg);
        }
    },
    d__Cb: function (callbackQuery, channelName, service) {
        "use strict";
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[service];

        if (!channelList) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        var pos = channelList.indexOf(channelName);
        if (pos === -1) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.channelDontExist,
                {
                    message_id: msg.message_id
                }
            );
        }

        channelList.splice(pos, 1);

        if (channelList.length === 0) {
            delete chatItem.serviceList[service];

            if (Object.keys(chatItem.serviceList).length === 0) {
                delete chatList[chatId];
            }
        }

        return base.storage.set({chatList: chatList}).then(function () {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.channelDeleted
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                {
                    message_id: msg.message_id
                }
            );
        });
    },
    delete_upd__Cb: function (callbackQuery, page) {
        "use strict";
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        var btnList = getDeleteChannelList.call(_this, chatItem, page);

        btnList.push([{
            text: 'Cancel',
            callback_data: '/c "delete"'
        }]);

        return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
            message_id: msg.message_id,
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    delete: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var msgText = _this.gOptions.language.selectDelChannel;

        var btnList = getDeleteChannelList.call(_this, chatItem, 0);

        btnList.push([{
            text: 'Cancel',
            callback_data: '/c "delete"'
        }]);

        return _this.gOptions.bot.sendMessage(chatId, msgText, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    option: function (msg, optionName, state) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        return setOption(chatItem, optionName, state).then(function (msgText) {
            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.sendMessage(chatId, msgText);
            });
        });
    },
    option__Cb: function (callbackQuery, optionName, state) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        return setOption(chatItem, optionName, state).then(function (msgText) {
            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
                    message_id: msg.message_id,
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(chatItem)
                    })
                });
            });
        });
    },
    options: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
            reply_markup: JSON.stringify({
                inline_keyboard: optionsBtnList(chatItem)
            })
        });
    },
    c__Cb: function (callbackQuery, command) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.editMessageText(
            chatId,
            _this.gOptions.language.commandCanceled
                .replace('{command}', command || ''),
            {
                message_id: msg.message_id
            }
        );
    },
    cancel: function (msg, arg1) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(
            chatId,
            _this.gOptions.language.commandCanceled.replace('{command}', arg1 || '')
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

        var btnList = [[{
            text: 'Yes',
            callback_data: '/clearyes'
        }, {
            text: 'No',
            callback_data: '/c "clear"'
        }]];

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.clearSure, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    clearyes__Cb: function(callbackQuery) {
        "use strict";
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        delete _this.gOptions.storage.chatList[chatId];

        return base.storage.set({chatList: _this.gOptions.storage.chatList}).then(function () {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.cleared,
                {
                    message_id: msg.message_id
                }
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
                    return base.htmlSanitize(channelName);
                }

                var title = base.getChannelTitle(_this.gOptions, service, channelName);

                return base.htmlSanitize('a', title, url);
            });
            serviceList.push(base.htmlSanitize('b', _this.gOptions.serviceToTitle[service]) + ':\n' + channelList.join('\n'));
        }

        return _this.gOptions.bot.sendMessage(
            chatId, serviceList.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            }
        );
    },
    watch: function (msg, channelId, service) {
        var _this = this;
        var chatId = msg.chat.id;
        
        var chatItem = this.gOptions.storage.chatList[chatId] || {};
        var options = chatItem.options || {};

        var lastStreamList = this.gOptions.storage.lastStreamList;
        var streamList = [];
        lastStreamList.forEach(function (stream) {
            if (stream._channelId === channelId && stream._service === service) {
                streamList.push(stream);
                return true;
            }
        });

        if (!streamList.length) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.streamIsNotFound);
        } else {
            var promiseList = streamList.map(function (stream) {
                var text = null;
                if (!options.hidePreview) {
                    text = base.getNowStreamPhotoText(_this.gOptions, stream);
                }
                var noPhotoText = base.getNowStreamText(_this.gOptions, stream);

                return _this.gOptions.checker.sendNotify([chatId], text, noPhotoText, stream, true).catch(function (err) {
                    debug('watch commend, sendNotify error! %s', err);
                });
            });
            return Promise.all(promiseList);
        }
    },
    online_upd__Cb: function (callbackQuery) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        var text = getOnlineText.call(_this, chatItem);

        var btnList = getWatchBtnList.call(_this, chatItem);

        btnList.unshift([{
            text: _this.gOptions.language.refresh,
            callback_data: '/online_upd'
        }]);

        return _this.gOptions.bot.editMessageText(chatId, text, {
            message_id: msg.message_id,
            disable_web_page_preview: true,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        }).catch(function (e) {
            var err = e && e.message || e;
            if (!/message is not modified/.test(err)) {
                throw e;
            }
        });
    },
    online: function (msg) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var text = getOnlineText.call(_this, chatItem);

        var btnList = getWatchBtnList.call(_this, chatItem);

        btnList.unshift([{
            text: _this.gOptions.language.refresh,
            callback_data: '/online_upd'
        }]);

        return _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    setchannel: function (msg, channelName) {
        "use strict";
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var onTimeout = function() {
            msg.text = '/cancel setchannel';
            return _this.onMessage(msg);
        };

        var onGetChannelName = function (msg, channelName) {
            channelName = channelName.trim();
            return Promise.try(function () {
                var options = base.getObjectItemOrObj(chatItem, 'options');

                if (channelName === 'remove') {
                    delete options.channel;
                    delete options.mute;

                    if (!Object.keys(options).length) {
                        delete chatItem.options;
                    }
                } else {
                    if (!/^@\w+$/.test(channelName)) {
                        throw new Error('BAD_FORMAT');
                    }

                    var exists = Object.keys(chatList).some(function (chatId) {
                        var item = chatList[chatId];
                        var options = item.options;

                        if (options && options.channel === channelName) {
                            return true;
                        }
                    });

                    if (exists) {
                        throw new Error('CHANNEL_EXISTS');
                    }

                    return _this.gOptions.bot.sendChatAction(channelName, 'typing').then(function () {
                        options.channel = channelName;
                    });
                }
            }).then(function () {
                return base.storage.set({chatList: chatList}).then(function () {
                    return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
                        reply_markup: JSON.stringify({
                            inline_keyboard: optionsBtnList(chatItem)
                        })
                    });
                });
            }, function (err) {
                debug('Set channel error! %s', err);

                var msgText = _this.gOptions.language.telegramChannelError;
                msgText = msgText.replace('{channelName}', channelName);
                return _this.gOptions.bot.sendMessage(chatId, msgText);
            });
        };

        var waitTelegramChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg, text) {
                msg.text = '/setchannel "' + text + '"';
                return _this.onMessage(msg);
            };
            onMessage.command = 'setchannel';
            onMessage.userId = msg.from.id;
            onMessage.timeout = setTimeout(function() {
                return onTimeout();
            }, 3 * 60 * 1000);

            var msgText = _this.gOptions.language.telegramChannelEnter;
            if (chatId < 0) {
                msgText += _this.gOptions.language.groupNote;
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, {
                reply_markup: JSON.stringify({
                    force_reply: true
                })
            });
        };

        if (channelName) {
            return onGetChannelName(msg, channelName);
        } else {
            return waitTelegramChannelName();
        }
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

        return Promise.try(function() {
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
        Object.keys(serviceChannelList).forEach(function (service) {
            if (!services[service]) {
                debug('Service "%s" is not found!', service);
                return;
            }

            if (service !== 'youtube') {
                return;
            }

            var channelList = serviceChannelList[service];
            queue = queue.then(function () {
                return Promise.all(channelList.map(function(userId) {
                    return services[service].getChannelId(userId);
                }));
            });
        });

        return queue.finally(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    },
    checkUserAlive: function(msg) {
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