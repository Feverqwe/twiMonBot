/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:chat');
const base = require('./base');
const Router = require('./router');
const CustomError = require('./customError').CustomError;
const querystring = require('querystring');

var Chat = function(options) {
    var _this = this;
    var bot = options.bot;
    this.gOptions = options;

    var language = options.language;
    var events = options.events;
    var services = options.services;
    var serviceToTitle = options.serviceToTitle;
    var users = options.users;
    var router = new Router(options);

    var textOrCb = router.custom(['text', 'callback_query']);

    router.message(function (req, next) {
        var chatId = req.getChatId();
        var message = req.message;
        var promise = Promise.resolve();
        if (message.migrate_from_chat_id) {
            promise = promise.then(function () {
                return users.changeChatId(message.migrate_from_chat_id, chatId);
            })
        }
        if (message.migrate_to_chat_id) {
            promise = promise.then(function () {
                return users.changeChatId(chatId, message.migrate_to_chat_id);
            });
        }
        promise.then(next);
    });

    router.callback_query(function (req, next) {
        var id = req.callback_query.id;
        bot.answerCallbackQuery(id).then(next).catch(function (err) {
            debug('answerCallbackQuery error! %o', err);
        });
    });

    textOrCb(/(.+)/, function (req, next) {
        next();
        if (req.message) {
            var entities = req.getEntities();
            var commands = entities.bot_command || [];
            commands.forEach(function (entity) {
                var command = entity.value;
                var m = /([^@]+)/.exec(command);
                if (m) {
                    command = m[1];
                }
                _this.gOptions.tracker.track(req.message.chat.id, 'command', command, req.message.text);
            });
        } else
        if (req.callback_query) {
            var message = req.callback_query.data;
            var command = '';
            var m = /(\/[^?\s]+)/.exec(message);
            if (m) {
                command = m[1];
            }
            var msg = JSON.parse(JSON.stringify(req.callback_query.message));
            msg.text = message;
            msg.from = req.callback_query.from;
            _this.gOptions.tracker.track(msg.chat.id, 'command', command, msg.text);
        }
    });

    router.text(/\/ping/, function (req) {
        var chatId = req.getChatId();
        bot.sendMessage(chatId, "pong").catch(function (err) {
            debug('Command ping error! %o', err);
        });
    });

    textOrCb(/\/(start|menu|help)/, function (req) {
        var chatId = req.getChatId();

        if (req.message) {
            var help = language.help;
            if (req.params[0] === 'help') {
                if (base.getRandomInt(0, 100) < 30) {
                    help += language.rateMe;
                }
            }
            bot.sendMessage(chatId, help, {
                disable_web_page_preview: true,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(0)
                })
            }).catch(function (err) {
                debug('Command start error! %o', err);
            });
        } else
        if (req.callback_query) {
            var messageId = req.getMessageId();
            var query = req.getQuery();
            bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: menuBtnList(query.page)
            }), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                if (/message is not modified/.test(err.message)) {
                    return;
                }
                debug('CallbackQuery start error! %o', err);
            });
        }
    });

    textOrCb(/\/top/, function (req) {
        var chatId = req.getChatId();

        return users.getAllChatChannels().then(function (_channels) {
            var chatIds = [];
            var channels = [];
            var services = [];

            var serviceObjMap = {};
            _channels.forEach(function (_channel) {
                var chatId = _channel.chatId;
                if (chatIds.indexOf(chatId) === -1) {
                    chatIds.push(chatId);
                }

                var service = serviceObjMap[_channel.service];
                if (!service) {
                    service = serviceObjMap[_channel.service] = {
                        name: _channel.service,
                        count: 0,
                        channels: [],
                        channelObjMap: {}
                    };
                    services.push(service);
                }

                var channelId = _channel.id;
                var channel = service.channelObjMap[channelId];
                if (!channel) {
                    channel = service.channelObjMap[channelId] = {
                        id: channelId,
                        title: _channel.title,
                        url: _channel.url,
                        count: 0
                    };
                    service.count++;
                    service.channels.push(channel);
                    channels.push(channel);
                }
                channel.count++;
            });
            serviceObjMap = null;

            var sortFn = function (aa, bb) {
                var a = aa.count;
                var b = bb.count;
                return a === b ? 0 : a > b ? -1 : 1;
            };

            services.sort(sortFn);

            services.forEach(function (service) {
                delete service.channelObjMap;

                service.channels.sort(sortFn).splice(10);
            });

            return {
                users: chatIds,
                channels: channels,
                services: services
            };
        }).then(function (info) {
            var textArr = [];

            textArr.push(language.users.replace('{count}', info.users.length));
            textArr.push(language.channels.replace('{count}', info.channels.length));

            return _this.gOptions.msgStack.getAllStreams().then(function (streams) {
                var onlineCount = streams.filter(function (item) {
                    return !item.isOffline;
                }).length;
                textArr.push(language.online.replace('{count}', onlineCount));

                info.services.forEach(function (service) {
                    textArr.push('');
                    textArr.push(serviceToTitle[service.name] + ':');
                    service.channels.forEach(function (channel, index) {
                        textArr.push((index + 1) + '. ' + channel.title);
                    });
                });

                return bot.sendMessage(chatId, textArr.join('\n'), {
                    disable_web_page_preview: true
                });
            });
        }).catch(function (err) {
            debug('Command top error! %o', err);
        });
    });

    textOrCb(/\/about/, function (req) {
        var chatId = req.getChatId();

        var liveTime = {
            endTime: '1970-01-01',
            message: [
                '{count}'
            ]
        };

        try {
            liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
            debug('Load liveTime.json error! %o', err);
        }

        var count = '';
        var endTime = /(\d{4}).(\d{2}).(\d{2})/.exec(liveTime.endTime);
        if (endTime) {
            endTime = (new Date(endTime[1], endTime[2], endTime[3])).getTime();
            count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
        }

        var message = liveTime.message;
        if (Array.isArray(message)) {
            message = message.join('\n');
        }

        message = message.replace('{count}', count);

        message += language.rateMe;

        return bot.sendMessage(chatId, message).catch(function (err) {
            debug('Command about error! %o', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        Promise.all([
            users.getChat(chatId).then(function (chat) {
                req.chat = chat;
            }),
            users.getChannels(chatId).then(function (channels) {
                req.channels = channels;
            })
        ]).then(next).catch(function (err) {
            debug('Get chat, channels error!', err);
        });
    });

    textOrCb(/\/online/, function (req) {
        var chatId = req.getChatId();
        var messageId = req.getMessageId();

        return _this.gOptions.msgStack.getLastStreamList().then(function (lastStreamList) {
            var text;
            if (req.channels.length) {
                text = getOnlineText(req.channels, lastStreamList);
            } else {
                text = language.emptyServiceList;
            }

            var query = req.getQuery();
            var btnList = getWatchBtnList(req.channels, query, lastStreamList);

            btnList.unshift([{
                text: language.refresh,
                callback_data: '/online'
            }]);

            var options = {
                disable_web_page_preview: true,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: btnList
                })
            };

            if (req.callback_query && !query.rel) {
                options.chat_id = chatId;
                options.message_id = messageId;
                return bot.editMessageText(text, options).catch(function (err) {
                    if (/message is not modified/.test(err.message)) {
                        return;
                    }
                    throw err;
                });
            } else {
                return bot.sendMessage(chatId, text, options);
            }
        }).catch(function (err) {
            debug('Command online error! %o', err);
        });
    });

    router.callback_query(/\/watch/, function (req) {
        var chatId = req.getChatId();
        var query = req.getQuery();

        return _this.gOptions.msgStack.getLastStreamList().then(function (lastStreamList) {
            var streamList = [];
            lastStreamList.some(function (stream) {
                if (stream._channelId === query.channelId && !stream._isOffline) {
                    streamList.push(stream);
                    return true;
                }
            });

            if (!streamList.length) {
                return bot.sendMessage(chatId, language.streamIsNotFound);
            }

            var promiseList = streamList.map(function (stream) {
                return sendStreamMessage(chatId, req.chat, stream).catch(function (err) {
                    debug('Command watch error! %o', err);
                });
            });

            return Promise.all(promiseList);
        });
    });

    textOrCb(/\/add(?:\s+(.+$))?/, function (req) {
        var chatId = req.getChatId();
        var channel = '';
        var serviceName = '';
        var query = {};
        var messageId = null;
        if (req.message) {
            channel = req.params[0] || '';
        } else
        if (req.callback_query) {
            query = req.getQuery();
            messageId = req.getMessageId();
            channel = query.channel || '';
            serviceName = query.service || '';
        }

        var getServiceName = function (channel) {
            var serviceName = '';
            Object.keys(services).some(function (_serviceName) {
                var service = services[_serviceName];
                if (service.isServiceUrl(channel)) {
                    serviceName = _serviceName;
                    return true;
                }
            });
            return serviceName;
        };

        if (!serviceName && channel) {
            serviceName = getServiceName(channel);
        }

        var onResponseChannel = function (channelName, serviceName, messageId) {
            return addChannel(req, serviceName, channelName).then(function (/*dbChannel*/channel) {
                var url = channel.url;
                var displayName = base.htmlSanitize('a', channel.title, url);

                var result = language.channelAdded
                    .replace('{channelName}', displayName)
                    .replace('{serviceName}', base.htmlSanitize(serviceToTitle[serviceName]));

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true,
                    parse_mode: 'HTML'
                }).then(function () {
                    return Promise.all([
                        users.getChannels(chatId),
                        _this.gOptions.msgStack.getLastStreamList()
                    ]).then(function (result) {
                        var channels = result[0];
                        var lastStreamList = result[1];
                        var onlineServiceList = getOnlineServiceChannelStreams(channels, lastStreamList);
                        var channelList = onlineServiceList[serviceName] || {};
                        var streamList = channelList[channel.id] || [];
                        streamList.forEach(function (stream) {
                            return sendStreamMessage(chatId, req.chat, stream).catch(function (err) {
                                debug('Command add error! %o', err);
                            });
                        });
                    });
                });
            }, function (err) {
                var result;
                if (err.message === 'CHANNEL_EXISTS') {
                    result = language.channelExists;
                } else {
                    result = language.channelIsNotFound
                        .replace('{channelName}', channelName)
                        .replace('{serviceName}', base.htmlSanitize(serviceToTitle[serviceName]));
                }

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true
                });
            });
        };

        if (channel && serviceName) {
            onResponseChannel(channel, serviceName, messageId).catch(function (err) {
                debug('Command add error! %o', err);
            });
            return;
        }

        var requestService = function (channel, messageId) {
            var msgText = language.enterService;
            var options = {};
            options.reply_markup = JSON.stringify({
                inline_keyboard: getServiceListKeyboard()
            });

            editOrSendNewMessage(chatId, messageId, msgText, options).then(function (msg) {
                return router.waitResponse(/\/add/, {
                    event: 'callback_query',
                    chatId: chatId,
                    fromId: req.getFromId()
                }, 3 * 60).then(function (req) {
                    return bot.answerCallbackQuery(req.callback_query.id).then(function () {
                        var query = req.getQuery();
                        if (query.cancel === 'true' || !query.service) {
                            return editOrSendNewMessage(chatId, msg.message_id, language.commandCanceled.replace('{command}', 'add'));
                        }

                        return onResponseChannel(channel, query.service, msg.message_id);
                    });
                }, function () {
                    var cancelText = language.commandCanceled.replace('{command}', 'add');
                    return editOrSendNewMessage(chatId, msg.message_id, cancelText);
                });
            }).catch(function (err) {
                debug('Command add error! %o', err);
            });
        };

        if (channel && !serviceName) {
            requestService(channel, messageId);
            return;
        }

        var requestChannel = function () {
            var options = {};
            var msgText = language.enterChannelName;
            if (chatId < 0) {
                msgText += language.groupNote;
                options.reply_markup = JSON.stringify({
                    force_reply: true
                });
            }

            bot.sendMessage(chatId, msgText, options).then(function (msg) {
                return router.waitResponse({
                    event: 'message',
                    type: 'text',
                    chatId: chatId,
                    fromId: req.getFromId(),
                    throwOnCommand: true
                }, 3 * 60).then(function (req) {
                    _this.gOptions.tracker.track(req.message.chat.id, 'command', '/add', req.message.text);

                    var channel = req.message.text;

                    if (!serviceName) {
                        serviceName = getServiceName(channel);
                    }

                    if (serviceName) {
                        return onResponseChannel(channel, serviceName, msg.message_id);
                    } else {
                        return requestService(channel, msg.message_id);
                    }
                }, function () {
                    var cancelText = language.commandCanceled.replace('{command}', 'add');
                    return editOrSendNewMessage(chatId, msg.message_id, cancelText);
                });
            }).catch(function (err) {
                debug('Command add error! %o', err);
            });
        };

        return requestChannel();
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.chat) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check chat error! %o', err);
            });
        } else {
            next();
        }
    });

    textOrCb(/\/clear/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        if (query.clear === 'true') {
            users.removeChat(chatId, 'By user').then(function () {
                return bot.editMessageText(language.cleared, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }).catch(function (err) {
                debug('Command clear error! %o', err);
            });
            return;
        }

        if (query.cancel) {
            bot.editMessageText(language.commandCanceled.replace('{command}', 'clear'), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command clear error! %o', err);
            });
            return;
        }

        var btnList = [[{
            text: 'Yes',
            callback_data: '/clear?clear=true'
        }, {
            text: 'No',
            callback_data: '/clear?cancel=true'
        }]];

        return bot.sendMessage(chatId, language.clearSure, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        }).catch(function (err) {
            debug('Command clear error! %o', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.channels.length) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check channel list error! %o', err);
            });
        } else {
            next();
        }
    });

    textOrCb(/\/delete/, function (req) {
        var chatId = req.getChatId();
        var query = req.getQuery();
        var messageId = req.getMessageId();
        var channels = req.channels;

        if (query.cancel) {
            var cancelText = language.commandCanceled.replace('{command}', 'delete');
            bot.editMessageText(cancelText, {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command delete error! %o', err);
            });
            return;
        }

        if (query.channelId) {
            deleteChannel(req, query.channelId).then(function (result) {
                if (req.callback_query) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                } else {
                    return bot.sendMessage(chatId, result);
                }
            }).catch(function (err) {
                debug('deleteChannel error! %o', err);
            });
            return;
        }

        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/delete?cancel=true'
        };

        var btnList = [];
        var promise = Promise.resolve();
        channels.forEach(function(channel) {
            var btnItem = {};

            btnItem.text = channel.title;
            btnItem.text += ' (' + serviceToTitle[channel.service] + ')';

            btnItem.callback_data = '/delete?' + querystring.stringify({
                channelId: channel.id
            });

            btnList.push([btnItem]);
        });

        return promise.then(function () {
            var pageBtnList = base.pageBtnList(query, btnList, '/delete', mediumBtn);

            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: pageBtnList
                }), {
                    chat_id: chatId,
                    message_id: messageId
                }).catch(function (err) {
                    if (/message is not modified/.test(err.message)) {
                        return;
                    }
                    throw err;
                });
            } else {
                return bot.sendMessage(chatId, language.selectDelChannel, {
                    reply_markup: JSON.stringify({
                        inline_keyboard: pageBtnList
                    })
                });
            }
        }).catch(function (err) {
            debug('Command delete error! %o', err);
        });
    });

    textOrCb(/\/options/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var promise = Promise.resolve();
        if (query.key) {
            promise = promise.then(function () {
                return setOption(req.chat, query.key, query.value);
            });
        }

        promise.then(function () {
            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: optionsBtnList(req.chat)
                }), {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                return bot.sendMessage(chatId, 'Options:', {
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(req.chat)
                    })
                });
            }
        }).catch(function (err) {
            debug('Command options error! %o', err);
        });
    });

    textOrCb(/\/setChannel/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var updateOptionsMessage = function () {
            return req.callback_query && bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: optionsBtnList(req.chat)
                }), {
                    chat_id: chatId,
                    message_id: messageId
                }).catch(function (err) {
                    if (/message is not modified/.test(err.message)) {
                        return;
                    }
                    throw err;
                });
        };

        if (query.remove) {
            delete req.chat.channelId;
            users.setChat(req.chat).then(function () {
                return updateOptionsMessage();
            }).catch(function (err) {
                debug('Command setChannel error! %o', err);
            });
            return;
        }

        var options = {};
        var msgText = language.telegramChannelEnter;
        if (chatId < 0) {
            msgText += language.groupNote;
            options.reply_markup = JSON.stringify({
                force_reply: true
            });
        }

        return bot.sendMessage(chatId, msgText, options).then(function (msg) {
            return router.waitResponse({
                event: 'message',
                type: 'text',
                chatId: chatId,
                fromId: req.getFromId(),
                throwOnCommand: true
            }, 3 * 60).then(function (_req) {
                _this.gOptions.tracker.track(_req.message.chat.id, 'command', '/setChannel', _req.message.text);
                return setChannel(req, _req.message.text).then(function (result) {
                    return editOrSendNewMessage(chatId, msg.message_id, result).then(function () {
                        return updateOptionsMessage();
                    });
                });
            }, function () {
                var cancelText = language.commandCanceled.replace('{command}', 'setChannel');
                return editOrSendNewMessage(chatId, msg.message_id, cancelText);
            });
        }).catch(function (err) {
            debug('setChannel error %o', err);
        });
    });

    textOrCb(/\/list/, function (req) {
        var chatId = req.chat.id;
        var query = req.getQuery();
        var channels = req.channels;

        var services = [];

        var serviceObjMap = {};
        channels.forEach(function (_channel) {
            var service = serviceObjMap[_channel.service];
            if (!service) {
                service = serviceObjMap[_channel.service] = {
                    name: _channel.service,
                    count: 0,
                    channels: [],
                    channelObjMap: {}
                };
                services.push(service);
            }

            var channelId = _channel.id;
            var channel = service.channelObjMap[channelId];
            if (!channel) {
                channel = service.channelObjMap[channelId] = {
                    id: channelId,
                    title: _channel.title,
                    url: _channel.url
                };
                service.count++;
                service.channels.push(channel);
            }
        });
        serviceObjMap = null;

        var sortFn = function (aa, bb) {
            var a = aa.count;
            var b = bb.count;
            return a === b ? 0 : a > b ? -1 : 1;
        };

        services.sort(sortFn);

        services.forEach(function (service) {
            delete service.channelObjMap;
        });

        return Promise.resolve(services).then(function (services) {
            if (!services.length) {
                return bot.sendMessage(chatId, language.emptyServiceList);
            }

            var serviceList = [];
            services.forEach(function (service) {
                var channelList = [];
                channelList.push(base.htmlSanitize('b', serviceToTitle[service.name]) + ':');
                service.channels.forEach(function (channel) {
                    channelList.push(base.htmlSanitize('a', channel.title, channel.url));
                });
                serviceList.push(channelList.join('\n'));
            });

            const fullText = serviceList.join('\n\n');

            const pageIndex = parseInt(query.page || 0);
            const pages = base.splitTextToPages(fullText);
            const prevPages = pages.splice(0, pageIndex);
            const pageText = pages.shift() || prevPages.shift();

            const pageControls = [];
            if (pageIndex > 0) {
                pageControls.push({
                    text: '<',
                    callback_data: '/list' + '?page=' + (pageIndex - 1)
                });
            }
            if (pages.length) {
                pageControls.push({
                    text: '>',
                    callback_data: '/list' + '?page=' + (pageIndex + 1)
                });
            }

            const options = {
                disable_web_page_preview: true,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: [pageControls]
                })
            };

            if (req.callback_query && !query.rel) {
                var messageId = req.getMessageId();
                return bot.editMessageText(pageText, Object.assign(options, {
                    chat_id: chatId,
                    message_id: messageId,
                }));
            } else {
                return bot.sendMessage(chatId, pageText, options);
            }
        }).catch(function (err) {
            debug('Command list error! %o', err);
        });
    });

    textOrCb(/\/cleanYoutubeChannels/, function (req) {
        const chatId = req.chat.id;
        const adminIds = _this.gOptions.config.adminIds || [];
        if (adminIds.indexOf(chatId) === -1) {
            return bot.sendMessage(chatId, 'Deny');
        }

        return _this.gOptions.users.getAllChannels().then(function (channels) {
            return channels.filter(function (channel) {
                return channel.service === 'youtube';
            });
        }).then(function (channels) {
            let promise = Promise.resolve();
            channels.forEach(function (channel) {
                promise = promise.then(function () {
                    return _this.gOptions.services.youtube.channelExists(channel).catch(function (err) {
                        if (!(err instanceof CustomError)) {
                            debug('getChannelId error! %s %o', channel.id, err);
                            return;
                        }

                        debug('Channel error! %s %o', channel.id, err);
                        return _this.gOptions.channels.removeChannel(channel.id);
                    });
                });
            });
            return promise;
        }).then(function () {
            return bot.sendMessage(chatId, 'Success');
        }).catch(function (err) {
            debug('Command cleanYoutubeChannels error! %o', err);
        });
    });

    textOrCb(/\/cleanTwitchChannels/, function (req) {
        const chatId = req.chat.id;
        const adminIds = _this.gOptions.config.adminIds || [];
        if (adminIds.indexOf(chatId) === -1) {
            return bot.sendMessage(chatId, 'Deny');
        }

        return _this.gOptions.users.getAllChannels().then(function (channels) {
            return channels.filter(function (channel) {
                return channel.service === 'twitch';
            });
        }).then(function (channels) {
            let promise = Promise.resolve();
            channels.forEach(function (channel) {
                promise = promise.then(function () {
                    return _this.gOptions.services.twitch.channelExists(channel).catch(function (err) {
                        if (!(err instanceof CustomError)) {
                            debug('channelExists error! %s %o', channel.id, err);
                            return;
                        }

                        debug('Channel error! %s %o', channel.id, err);
                        return _this.gOptions.channels.removeChannel(channel.id);
                    });
                });
            });
            return promise;
        }).then(function () {
            return bot.sendMessage(chatId, 'Success');
        }).catch(function (err) {
            debug('Command cleanTwitchChannels error! %o', err);
        });
    });

    textOrCb(/\/removeUnusedChannels/, function (req) {
        const chatId = req.chat.id;
        const adminIds = _this.gOptions.config.adminIds || [];
        if (adminIds.indexOf(chatId) === -1) {
            return bot.sendMessage(chatId, 'Deny');
        }

        return _this.gOptions.channels.removeUnusedChannels().then(function () {
            return bot.sendMessage(chatId, 'Success');
        }).catch(function (err) {
            debug('Command removeUnusedChannels error! %o', err);
        });
    });

    var sendStreamMessage = function (chatId, chat, stream) {
        var text = base.getNowStreamText(_this.gOptions, stream);
        var caption = '';
        if (!chat || !chat.options.hidePreview) {
            caption = base.getNowStreamPhotoText(_this.gOptions, stream);
        }
        return _this.gOptions.msgStack.sendStreamMessage(chatId, stream._id, {
            imageFileId: stream._photoId,
            caption: caption,
            text: text
        }, stream, true, chatId);
    };

    /**
     * @param {Number|String} chatId
     * @param {Number} messageId
     * @param {String} text
     * @param {{}} [details]
     */
    var editOrSendNewMessage = function (chatId, messageId, text, details) {
        details = details || {};

        var sendMessage = function () {
            return bot.sendMessage(chatId, text, details);
        };

        var editMessage = function () {
            var _details = {};
            for (var key in details) {
                _details[key] = details[key];
            }
            _details.chat_id = chatId;
            _details.message_id = messageId;
            return bot.editMessageText(text, _details).catch(function (err) {
                if (/message can't be edited/.test(err.message) ||
                    /message to edit not found/.test(err.message)
                ) {
                    return sendMessage();
                }
                throw err;
            });
        };

        if (messageId) {
            return editMessage();
        } else {
            return sendMessage();
        }
    };

    var setChannel = function (req, channelId) {
        var chat = req.chat;
        return Promise.resolve().then(function () {
            channelId = channelId.trim();

            if (!/^@\w+$/.test(channelId)) {
                throw new Error('BAD_FORMAT');
            }

            return users.getChatByChannelId(channelId).then(function (channelChat) {
                if (channelChat) {
                    throw new Error('CHANNEL_EXISTS');
                }

                return bot.sendChatAction(channelId, 'typing').then(function () {
                    chat.options.mute = false;
                    chat.channelId = channelId;
                });
            }).then(function () {
                return users.setChat(chat);
            }).then(function () {
                return language.telegramChannelSet.replace('{channelName}', channelId);
            });
        }).catch(function (err) {
            var msgText = language.telegramChannelError.replace('{channelName}', channelId);
            if (err.message === 'BAD_FORMAT') {
                msgText += ' Channel name is incorrect.';
            } else
            if (err.message === 'CHANNEL_EXISTS') {
                msgText += ' The channel has already been added.';
            } else
            if (/bot is not a member of the (?:channel|supergroup) chat/.test(err.message)) {
                msgText += ' Bot must be admin in this channel.';
            } else
            if (/chat not found/.test(err.message)) {
                msgText += ' Telegram chat is not found!';
            } else {
                debug('setChannel %s error! %o', channelId, err);
            }
            return msgText;
        });
    };

    var setOption = function (chat, key, value) {
        ['hidePreview', 'mute', 'unMuteRecords'].forEach(function (option) {
            if (option === key) {
                chat.options[option] = value === 'true';
                if (!chat.options[option]) {
                    delete chat.options[option];
                }
            }
        });

        return users.setChat(chat);
    };

    /**
     * @param {Object} req
     * @param {String} channelId
     * @return {Promise.<String>}
     */
    var deleteChannel = function (req, channelId) {
        var channel = null;
        req.channels.some(function (/**dbChannel*/_channel) {
            if (_channel.id === channelId) {
                channel = _channel;
                return true;
            }
        });

        if (!channel) {
            return Promise.resolve(language.channelDontExist);
        }

        return users.removeChannel(req.chat.id, channel.id).then(function () {
            return users.getChannels(req.chat.id).then(function (channels) {
                if (channels.length === 0) {
                    return users.removeChat(req.chat.id, 'Empty channels');
                }
            });
        }).then(function () {
            return language.channelDeleted
                .replace('{channelName}', channel.title)
                .replace('{serviceName}', serviceToTitle[channel.service]);
        });
    };


    var addChannel = function (req, serviceName, channelName) {
        var chatId = req.getChatId();
        return services[serviceName].getChannelId(channelName).then(function (channel) {
            var channelId = channel.id;
            // var title = channel.title;

            var found = req.channels.some(function (channel) {
                return channel.id === channelId;
            });

            if (found) {
                throw new CustomError('CHANNEL_EXISTS');
            }


            return users.getChat(chatId).then(function (chat) {
                if (!chat) {
                    return users.setChat({id: chatId});
                }
            }).then(function () {
                return users.addChannel(chatId, channelId);
            }).then(function () {
                return channel;
            });
        }).catch(function(err) {
            if (!(err instanceof CustomError)) {
                debug('addChannel %s error! %o', channelName, err);
            } else
            if (err.message !== 'CHANNEL_EXISTS') {
                debug('Channel is not found! %s %o', channelName, err);
            }
            throw err;
        });
    };

    var menuBtnList = function (page) {
        var btnList = null;
        if (page > 0) {
            btnList = [
                [
                    {
                        text: 'Options',
                        callback_data: '/options?rel=menu'
                    }
                ],
                [
                    {
                        text: '<',
                        callback_data: '/menu?page=0'
                    },
                    {
                        text: 'Top 10',
                        callback_data: '/top'
                    },
                    {
                        text: 'About',
                        callback_data: '/about'
                    }
                ]
            ];
        } else {
            btnList = [
                [
                    {
                        text: 'Online',
                        callback_data: '/online?rel=menu'
                    },
                    {
                        text: 'Show the channel list',
                        callback_data: '/list?rel=menu'
                    }
                ],
                [
                    {
                        text: 'Add channel',
                        callback_data: '/add'
                    },
                    {
                        text: 'Delete channel',
                        callback_data: '/delete?rel=menu'
                    },
                    {
                        text: '>',
                        callback_data: '/menu?page=1'
                    }
                ]
            ];
        }

        return btnList;
    };

    var optionsBtnList = function (chat) {
        var options = chat.options;

        var btnList = [];

        if (options.hidePreview) {
            btnList.push([{
                text: 'Show preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: false
                })
            }]);
        } else {
            btnList.push([{
                text: 'Hide preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: true
                })
            }]);
        }

        if (options.unMuteRecords) {
            btnList.push([{
                text: 'Mute records',
                callback_data: '/options?' + querystring.stringify({
                    key: 'unMuteRecords',
                    value: false
                })
            }]);
        } else {
            btnList.push([{
                text: 'Unmute records',
                callback_data: '/options?' + querystring.stringify({
                    key: 'unMuteRecords',
                    value: true
                })
            }]);
        }

        if (chat.channelId) {
            btnList.push([{
                text: 'Remove channel (' + chat.channelId + ')',
                callback_data: '/setChannel?' +  querystring.stringify({
                    remove: true
                })
            }]);
        } else {
            btnList.push([{
                text: 'Set channel',
                callback_data: '/setChannel'
            }]);
        }

        if (chat.channelId) {
            if (options.mute) {
                btnList.push([{
                    text: 'Unmute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: false
                    })
                }]);
            } else {
                btnList.push([{
                    text: 'Mute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: true
                    })
                }]);
            }
        }

        return btnList;
    };

    var getServiceListKeyboard = function() {
        var last = [];
        var btnList = [last];
        for (var service in services) {
            if (last.length === 2) {
                last = [];
                btnList.push(last);
            }
            last.push({
                text: serviceToTitle[service],
                callback_data: '/add?' + querystring.stringify({
                    service: service
                })
            });
        }
        btnList.push([{
            text: 'Cancel',
            callback_data: '/add?' + querystring.stringify({
                cancel: true
            })
        }]);
        return btnList;
    };

    var getWatchBtnList = function (channels, query, lastStreamList) {
        var btnList = [];

        var serviceChannelStreams = getOnlineServiceChannelStreams(channels, lastStreamList);
        Object.keys(serviceChannelStreams).forEach(function (service) {
            var channelStreams = serviceChannelStreams[service];

            Object.keys(channelStreams).forEach(function (channelId) {
                var streams = channelStreams[channelId];
                if (!streams.length) {
                    return;
                }

                var title = streams[0].channel.name;
                var text = title + ' (' + serviceToTitle[service] + ')';

                btnList.push([{
                    text: text,
                    callback_data: '/watch?' + querystring.stringify({
                        channelId: channelId
                    })
                }]);
            });
        });

        return base.pageBtnList(query, btnList, '/online');
    };

    var getOnlineServiceChannelStreams = function (channels, lastStreamList) {
        var serviceList = {};
        channels.forEach(function (channel) {
            for (var i = 0, stream; stream = lastStreamList[i]; i++) {
                if (stream._channelId !== channel.id) continue;

                var serviceChannels = serviceList[channel.service];
                if (!serviceChannels) {
                    serviceChannels = serviceList[channel.service] = {};
                }

                var streamList = serviceChannels[stream._channelId];
                if (!streamList) {
                    streamList = serviceChannels[stream._channelId] = [];
                }
                streamList.push(stream);
            }
        });
        var orderedServiceList = {};
        Object.keys(services).forEach(function (serviceName) {
            if (serviceList[serviceName]) {
                orderedServiceList[serviceName] = serviceList[serviceName];
            }
        });
        return orderedServiceList;
    };

    var getOnlineText = function (channels, lastStreamList) {
        var onlineList = [];

        var serviceList = getOnlineServiceChannelStreams(channels, lastStreamList);
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
            onlineList.unshift(language.offline);
        }

        return onlineList.join('\n\n');
    };
};


module.exports = Chat;