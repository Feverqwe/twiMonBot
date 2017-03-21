/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:chat');
var base = require('./base');
var Router = require('./router');
var CustomError = require('./customError').CustomError;
var querystring = require('querystring');

var Chat = function(options) {
    var _this = this;
    var bot = options.bot;
    this.gOptions = options;

    var language = options.language;
    var services = options.services;
    var serviceToTitle = options.serviceToTitle;
    var router = new Router(bot);

    var textOrCb = router.custom(['text', 'callback_query']);

    router.message(function (req, next) {
        var chatId = req.getChatId();
        var message = req.message;
        var promise = Promise.resolve();
        if (message.migrate_from_chat_id) {
            promise = promise.then(function () {
                return _this.chatMigrate(message.migrate_from_chat_id, chatId);
            })
        }
        if (message.migrate_to_chat_id) {
            promise = promise.then(function () {
                return _this.chatMigrate(chatId, message.migrate_to_chat_id);
            });
        }
        promise.then(next);
    });

    router.callback_query(function (req, next) {
        var id = req.callback_query.id;
        bot.answerCallbackQuery(id).then(next).catch(function (err) {
            debug('answerCallbackQuery error!', err);
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
                _this.track(req.message, command);
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
            _this.track(msg, command);
        }
    });

    router.text(/\/ping/, function (req) {
        var chatId = req.getChatId();
        bot.sendMessage(chatId, "pong").catch(function (err) {
            debug('Command ping error!', err);
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
                debug('Command start error!', err);
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
                debug('CallbackQuery start error!', err);
            });
        }
    });

    textOrCb(/\/top/, function (req) {
        var chatId = req.getChatId();

        return getAllChatChannels().then(function (items) {
            var users = [];
            var channels = [];
            var services = [];

            var serviceObjMap = {};
            items.forEach(function (item) {
                var chatId = item.chatId;
                if (users.indexOf(chatId) === -1) {
                    users.push(chatId);
                }

                var service = serviceObjMap[item.service];
                if (!service) {
                    service = serviceObjMap[item.service] = {
                        name: item.service,
                        count: 0,
                        channels: [],
                        channelObjMap: {}
                    };
                    services.push(service);
                }

                var channelId = item.channelId;
                var channel = service.channelObjMap[channelId];
                if (!channel) {
                    channel = service.channelObjMap[channelId] = {
                        id: channelId,
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

            return Promise.all(services.map(function (service) {
                return Promise.all(service.channels.map(function (channel) {
                    return base.getChannelTitle(options, service.name, channel.id).then(function (title) {
                        channel.title = title;
                    })
                }));
            })).then(function () {
                return {
                    users: users,
                    channels: channels,
                    services: services
                };
            });
        }).then(function (info) {
            var textArr = [];

            textArr.push(language.users.replace('{count}', info.users.length));
            textArr.push(language.channels.replace('{count}', info.channels.length));

            var onlineCount = _this.gOptions.storage.lastStreamList.filter(function (item) {
                return !item._isOffline;
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
        }).catch(function (err) {
            debug('Command top error!', err);
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
            debug('Load liveTime.json error!', err);
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
            debug('Command about error!', err);
        }).catch(function (err) {
            debug('Command about error!', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        Promise.all([
            getChat(chatId).then(function (chat) {
                req.chat = chat;
            }),
            getChannels(chatId).then(function (channels) {
                req.channels = channels;
            })
        ]).then(next).catch(function (err) {
            debug('Get chat, channels error!', err);
        });
    });

    textOrCb(/\/online/, function (req) {
        var chatId = req.getChatId();
        var messageId = req.getMessageId();
        var text = getOnlineText(req.channels);
        var page = query.page || 0;
        return getWatchBtnList(req.channels, page).then(function (btnList) {
            btnList.unshift([{
                text: language.refresh,
                callback_data: '/online'
            }]);

            return editOrSendNewMessage(chatId, messageId, text, {
                disable_web_page_preview: true,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: btnList
                })
            });
        }).catch(function (err) {
            debug('Command online error!', err);
        });
    });

    router.callback_query(/\/watch/, function (req) {
        var chatId = req.getChatId();
        var query = req.query;

        var lastStreamList = this.gOptions.storage.lastStreamList;
        var streamList = [];
        lastStreamList.some(function (stream) {
            if (stream._channelId === query.channelId && stream._service === query.service) {
                streamList.push(stream);
                return true;
            }
        });

        if (!streamList.length) {
            return bot.sendMessage(chatId, language.streamIsNotFound);
        }

        var promiseList = streamList.map(function (stream) {
            var text = '';
            if (!req.chat.options.hidePreview) {
                text = base.getNowStreamPhotoText(_this.gOptions, stream);
            }
            var noPhotoText = base.getNowStreamText(_this.gOptions, stream);

            return _this.gOptions.msgSender.sendNotify([chatId], text, noPhotoText, stream, true).catch(function (err) {
                debug('Command watch error!', err);
            });
        });

        return Promise.all(promiseList).catch(function (err) {
            debug('Command watch error!', err);
        });
    });

    textOrCb(/\/add(?:\s+(.+$))?/, function (req) {
        var chatId = req.getChatId();
        var channel = '';
        var serviceName = '';
        if (req.message) {
            channel = req.params[0] || '';
        }

        if (!serviceName && channel) {
            Object.keys(services).some(function (_serviceName) {
                var service = services[_serviceName];
                if (service.isServiceUrl(channel)) {
                    serviceName = _serviceName;
                    return true;
                }
            });
        }

        var onResponseChannel = function (channelName, serviceName, messageId) {
            return addChannel(req, serviceName, channelName).then(function (/*ChannelInfo*/channel) {
                var url = base.getChannelUrl(serviceName, channel.id);
                var displayName = base.htmlSanitize('a', channel.title, url);

                var result = language.channelAdded
                    .replace('{channelName}', displayName)
                    .replace('{serviceName}', base.htmlSanitize(serviceToTitle[serviceName]));

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true,
                    parse_mode: 'HTML'
                });
            }, function (err) {
                var result;
                if (err.message === 'CHANNEL_EXISTS') {
                    result = language.channelExists;
                } else {
                    result = language.channelIsNotFound.replace('{channelName}', channelName);
                }

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true
                });
            });
        };

        if (channel && serviceName) {
            onResponseChannel(channel, serviceName).catch(function (err) {
                debug('Command add error!', err);
            });
            return;
        }

        var requestChannel = function (msg) {
            var options = {};
            var msgText = language.enterChannelName;
            if (chatId < 0) {
                msgText += language.groupNote;
                options.reply_markup = JSON.stringify({
                    force_reply: true
                });
            }

            return editOrSendNewMessage(chatId, msg.message_id, msgText, options).then(function (msg) {
                return router.waitResponse({
                    event: 'message',
                    type: 'text',
                    chatId: chatId,
                    fromId: req.getFromId(),
                    throwOnCommand: true
                }, 3 * 60).then(function (req) {
                    _this.track(req.message, '/add');
                    return onResponseChannel(req.message.text, serviceName, msg.message_id);
                }, function () {
                    var cancelText = language.commandCanceled.replace('{command}', 'add');
                    return editOrSendNewMessage(chatId, msg.message_id, cancelText);
                });
            }).catch(function (err) {
                debug('Command add error!', err);
            });
        };

        var requestService = function () {
            var msgText = language.enterService;
            var options = {};
            options.reply_markup = JSON.stringify({
                inline_keyboard: getServiceListKeyboard()
            });

            bot.sendMessage(chatId, msgText, options).then(function (msg) {
                return router.waitResponse(/\/add/, {
                    event: 'callback_query',
                    chatId: chatId,
                    fromId: req.getFromId()
                }, 3 * 60).then(function (req) {
                    var query = req.getQuery();
                    if (query.cancel === 'true') {
                        return editOrSendNewMessage(chatId, msg.message_id, language.commandCanceled.replace('{command}', 'add'));
                    }

                    _this.track(req.message, '/add');

                    serviceName = query.service;

                    if (channel) {
                        return onResponseChannel(channel, serviceName, msg.message_id);
                    } else {
                        return requestChannel(msg);
                    }
                }, function () {
                    var cancelText = language.commandCanceled.replace('{command}', 'add');
                    return editOrSendNewMessage(chatId, msg.message_id, cancelText);
                });
            }).catch(function (err) {
                debug('Command add error!', err);
            });
        };

        return requestService();
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.chat) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check chat error!', err);
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
            removeChat(chatId).then(function () {
                return bot.editMessageText(language.cleared, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }).catch(function (err) {
                debug('Command clear error!', err);
            });
            return;
        }

        if (query.cancel) {
            bot.editMessageText(language.commandCanceled.replace('{command}', 'clear'), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command clear error!', err);
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
            debug('Command clear error!', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.channels.length) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check channel list error!', err);
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
                debug('Command delete error!', err);
            });
            return;
        }

        if (query.channelId) {
            deleteChannel(req, query.channelId, query.service).then(function (result) {
                if (req.callback_query) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                } else {
                    return bot.sendMessage(chatId, result);
                }
            }).catch(function (err) {
                debug('deleteChannel error!', err);
            });
            return;
        }

        var page = query.page || 0;
        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/delete?cancel=true'
        };

        var btnList = [];
        var promise = Promise.resolve();
        channels.forEach(function(item) {
            promise = promise.then(function () {
                return base.getChannelTitle(_this.gOptions, item.service, item.channelId).then(function (title) {
                    var btnItem = {};

                    btnItem.text = title;
                    btnItem.text += ' (' + serviceToTitle[item.service] + ')';

                    btnItem.callback_data = '/delete?' + querystring.stringify({
                            channelId: item.channelId,
                            service: item.service
                        });

                    btnList.push([btnItem]);
                });
            });
        });

        return promise.then(function () {
            var pageBtnList = base.pageBtnList(btnList, '/delete', page, mediumBtn);

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
            debug('Command delete error!', err);
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
            debug('Command options error!', err);
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
            setChat(req.chat).then(function () {
                return updateOptionsMessage();
            }).catch(function (err) {
                debug('Command setChannel error!', err);
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
                _this.track(_req.message, '/setChannel');
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
            debug('setChannel error', err);
        });
    });

    textOrCb(/\/list/, function (req) {
        var chatId = req.chat.id;
        var channels = req.channels;

        var services = [];

        var serviceObjMap = {};
        channels.forEach(function (item) {
            var service = serviceObjMap[item.service];
            if (!service) {
                service = serviceObjMap[item.service] = {
                    name: item.service,
                    count: 0,
                    channels: [],
                    channelObjMap: {}
                };
                services.push(service);
            }

            var channelId = item.channelId;
            var channel = service.channelObjMap[channelId];
            if (!channel) {
                channel = service.channelObjMap[channelId] = {
                    id: channelId
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

        return Promise.all(services.map(function (service) {
            return Promise.all(service.channels.map(function (channel) {
                return base.getChannelTitle(_this.gOptions, service.name, channel.id).then(function (title) {
                    channel.title = title;
                })
            }));
        })).then(function () {
            return {
                services: services
            };
        }).then(function (info) {
            if (!info.services.length) {
                return bot.sendMessage(chatId, language.emptyServiceList);
            }

            var serviceList = [];
            info.services.forEach(function (service) {
                var channelList = [];
                channelList.push(base.htmlSanitize('b', serviceToTitle[service.name]) + ':');
                service.channels.forEach(function (channel) {
                    channelList.push(base.htmlSanitize('a', channel.title, base.getChannelUrl(service.name, channel.id)));
                });
                serviceList.push(channelList.join('\n'));
            });

            return bot.sendMessage(chatId, serviceList.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            });
        }).catch(function (err) {
            debug('Command list error!', err);
        });
    });

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

            return getChatByChannelId(channelId).then(function (channelChat) {
                if (channelChat) {
                    throw new Error('CHANNEL_EXISTS');
                }

                return bot.sendChatAction(channelId, 'typing').then(function () {
                    chat.options.mute = false;
                    chat.channelId = channelId;
                });
            }).then(function () {
                return setChat(chat);
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
                debug('setChannel %s error!', channelId, err);
            }
            return msgText;
        });
    };

    var getChatByChannelId = function (channelId) {
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            for (var chatId in chatList) {
                var chatItem = chatList[chatId];
                var options = chatItem.options || {};
                if (options.channel === channelId) {
                    return getChat(chatId);
                }
            }
        }).catch(function (err) {
            debug('getAllChatChannels', err);
        });
    };

    var setOption = function (chat, key, value) {
        ['hidePreview', 'mute'].forEach(function (option) {
            if (option === key) {
                chat.options[option] = value === 'true';
                if (!chat.options[option]) {
                    delete chat.options[option];
                }
            }
        });

        return setChat(chat);
    };

    var deleteChannel = function (req, channelId, serviceName) {
        var found = req.channels.some(function (item) {
            return item.service === serviceName && item.channelId === channelId;
        });

        if (!found) {
            return language.channelDontExist;
        }

        return removeChannel(req.chat.id, serviceName, channelId).then(function () {
            return getChannels(req.chat.id).then(function (channels) {
                if (channels.length === 0) {
                    return removeChat(req.chat.id);
                }
            });
        }).then(function () {
            return language.channelDeleted.replace('{channelName}', channelId);
        });
    };

    /**
     * @param {String} chatId
     * @param {String} serviceName
     * @param {String} channelId
     * @return {Promise}
     */
    var removeChannel = function (chatId, serviceName, channelId) {
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            var chatItem = chatList[chatId];
            var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[serviceName];
            var pos = channelList.indexOf(channelId);
            if (pos !== -1) {
                channelList.splice(pos, 1);
            }
            return base.storage.set({chatList: chatList});
        });
    };

    var setChat = function (chat) {
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chat.id];
        if (!chatItem) {
            chatItem = chatList[chat.id] = {
                chatId: chat.id,
                serviceList: {}
            };
        }

        var options = chatItem.options;
        if (!options) {
            options = chatItem.options = {};
        }

        options.channel = chat.channelId;
        options.hidePreview = chat.options.hidePreview;
        options.mute = chat.options.mute;

        return base.storage.set({chatList: _this.gOptions.storage.chatList});
    };

    /**
     * @param {String} chatId
     * @return {Promise}
     */
    var removeChat = function (chatId) {
        return Promise.resolve().then(function () {
            delete _this.gOptions.storage.chatList[chatId];
            return base.storage.set({chatList: _this.gOptions.storage.chatList});
        });
    };

    /**
     * @param {String} chatId
     * @return {Promise.<{id: String, channelId: String, options: Object}>}
     */
    var getChat = function (chatId) {
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            var chatItem = chatList[chatId];
            if (!chatItem) {
                return null;
            }

            var options = chatItem.options || {};
            return {
                id: chatItem.chatId,
                channelId: options.channel,
                options: {
                    hidePreview: options.hidePreview,
                    mute: options.mute
                }
            };
        }).catch(function (err) {
            debug('getChannels', err);
        });
    };

    /**
     * @param {String} chatId
     * @return {Promise.<{service: String, channelId: String}[]>}
     */
    var getChannels = function (chatId) {
        var result = [];
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            var chatItem = chatList[chatId];
            if (chatItem) {
                for (var serviceName in chatItem.serviceList) {
                    chatItem.serviceList[serviceName].forEach(function (channelId) {
                        result.push({
                            channelId: channelId,
                            service: serviceName
                        });
                    });
                }
            }
        }).catch(function (err) {
            debug('getChannels', err);
        }).then(function () {
            return result;
        });
    };

    /**
     * @return {Promise.<{chatId: String, service: String, channelId: String}[]>}
     */
    var getAllChatChannels = function () {
        var result = [];
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            for (var chatId in chatList) {
                var chatItem = chatList[chatId];
                for (var serviceName in chatItem.serviceList) {
                    chatItem.serviceList[serviceName].forEach(function (channelId) {
                        result.push({
                            chatId: chatId,
                            service: serviceName,
                            channelId: channelId
                        });
                    });
                }
            }
        }).catch(function (err) {
            debug('getAllChatChannels', err);
        }).then(function () {
            return result;
        });
    };


    var addChannel = function (req, serviceName, channelName) {
        var chatId = req.getChatId();
        return services[serviceName].getChannelId(channelName).then(function (channel) {
            var channelId = channel.id;
            // var title = channel.title;

            var found = req.channels.some(function (item) {
                return item.service === serviceName && item.channelId === channelId;
            });

            if (found) {
                throw new CustomError('CHANNEL_EXISTS');
            }

            var promise = Promise.resolve();
            if (!req.chat) {
                promise = promise.then(function () {
                    return setChat({id: chatId});
                });
            }
            return promise.then(function () {
                return usersAddChannel(chatId, serviceName, channelId);
            }).then(function () {
                return channel;
            });
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                debug('addChannel %s error!', channelName, err);
            } else
            if (err.message !== 'CHANNEL_EXISTS') {
                debug('Channel is not found! %j', channelName, err);
            }
            throw err;
        });
    };

    var usersAddChannel = function (chatId, serviceName, channelId) {
        return Promise.resolve().then(function () {
            var chatList = _this.gOptions.storage.chatList;
            var chatItem = chatList[chatId];
            if (chatItem) {
                var serviceList = chatItem.serviceList;
                if (!serviceList) {
                    serviceList = chatItem.serviceList = {};
                }
                var serviceChannels = serviceList[serviceName];
                if (!serviceChannels) {
                    serviceChannels = serviceList[serviceName] = [];
                }
                if (serviceChannels.indexOf(channelId) === -1) {
                    serviceChannels.push(channelId);
                }
                return base.storage.set({chatList: chatList});
            }
        }).catch(function (err) {
            debug('getChannels', err);
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

    var getWatchBtnList = function (channels, page) {
        var _this = this;
        var btnList = [];

        var promise = Promise.resolve();
        var serviceList = getOnlineChannelList(channels);
        Object.keys(serviceList).forEach(function (service) {
            var channelList = serviceList[service];

            Object.keys(channelList).forEach(function (channelId) {
                var streamList = channelList[channelId];
                if (!streamList.length) {
                    return;
                }

                promise = promise.then(function () {
                    return base.getChannelTitle(_this.gOptions, service, channelId).then(function (title) {
                        var text = title + ' (' + serviceToTitle[service] + ')';

                        btnList.push([{
                            text: text,
                            callback_data: '/watch ' + channelId + ' ' + service
                        }]);
                    });
                });
            });
        });

        return promise.then(function () {
            return base.pageBtnList(btnList, '/online', page);
        });
    };

    var getOnlineChannelList = function (channels) {
        var lastStreamList = _this.gOptions.storage.lastStreamList;
        var serviceList = {};
        channels.forEach(function (item) {
            for (var i = 0, stream; stream = lastStreamList[i]; i++) {
                if (stream._isOffline) continue;
                if (stream._service !== item.service) continue;
                if (stream._channelId !== item.channelId) continue;

                var serviceChannels = serviceList[item.service];
                if (!serviceChannels) {
                    serviceChannels = serviceList[item.service] = [];
                }
                serviceChannels.push(stream);
            }
        });
        return serviceList;
    };

    var getOnlineText = function (channels) {
        var _this = this;
        var onlineList = [];

        var serviceList = getOnlineChannelList(channels);
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

Chat.prototype.chatMigrate = function(oldChatId, newChatId) {
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

Chat.prototype.track = function(msg, command) {
    return this.gOptions.tracker.track({
        text: msg.text,
        from: {
            id: msg.from.id
        },
        chat: {
            id: msg.chat.id
        },
        date: msg.date
    }, command);
};


module.exports = Chat;