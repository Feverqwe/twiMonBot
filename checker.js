/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');
var debugLog = require('debug')('checker:log');
debugLog.log = console.log.bind(console);
var request = require('request');
var requestPromise = Promise.promisify(request);

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error! "%s"', err);
        });
    });
};

Checker.prototype.cleanStreamList = function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);

    for (var i = 0, item; item = streamList[i]; i++) {
        if (now - item._addItemTime > this.gOptions.config.timeout && item._isOffline) {
            rmList.push(item);
            debugLog('[s]', 'R-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
        }
        item._isOffline = true;
    }

    for (i = 0; item = rmList[i]; i++) {
        streamList.splice(streamList.indexOf(item), 1);
    }
};

Checker.prototype.getBrokenItems = function(cItem, nItem) {
    "use strict";
    var brokenItems = [];
    [cItem, nItem].forEach(function(item) {
        if (!item._isBroken) {
            return;
        }
        for (var n = 0, key; key = item._isBroken[n]; n++) {
            if (brokenItems.indexOf(key) === -1) {
                brokenItems.push(key);
            }
        }
    });
    return brokenItems;
};

Checker.prototype.isStatusChange = function(cItem, nItem) {
    var brokenItems = this.getBrokenItems(cItem, nItem);

    if (cItem.game !== nItem.game && brokenItems.indexOf('game') === -1) {
        return true;
    }

    if (cItem.channel.status !== nItem.channel.status && brokenItems.indexOf('status') === -1) {
        return true;
    }

    return false;
};

Checker.prototype.isEqualChannel = function(cItem, nItem) {
    var brokenItems = this.getBrokenItems(cItem, nItem);

    var a = cItem.channel;
    var b = nItem.channel;
    for (var key in a) {
        if (brokenItems.indexOf(key) !== -1) {
            continue;
        }
        if (a[key] !== b[key]) {
            return false;
        }
    }
    return true;
};

Checker.prototype.isNotDblItem = function(nItem) {
    var now = parseInt(Date.now() / 1000);

    var lastStreamList = this.gOptions.storage.lastStreamList;

    for (var i = 0, cItem; cItem = lastStreamList[i]; i++) {
        if (cItem._service !== nItem._service) {
            continue;
        }

        if (now - cItem._addItemTime < this.gOptions.config.timeout && cItem.game === nItem.game && this.isEqualChannel(cItem, nItem)) {
            return false;
        }
    }

    return true;
};

Checker.prototype.getChannelList = function() {
    "use strict";
    var serviceList = {};
    var chatList = this.gOptions.storage.chatList;

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];
        for (var service in chatItem.serviceList) {
            var channelList = serviceList[service] = serviceList[service] || [];

            var userChannelList = chatItem.serviceList[service];
            for (var i = 0, channelName; channelName = userChannelList[i]; i++) {
                if (channelList.indexOf(channelName) !== -1) {
                    continue;
                }
                channelList.push(channelName);
            }
        }
    }

    return serviceList;
};

Checker.prototype.onSendMsgError = function(err, chatId) {
    err = err && err.message || err;
    var needKick = /^403\s+/.test(err);

    if (!needKick) {
        needKick = /group chat is deactivated/.test(err);
    }

    var jsonRe = /^\d+\s+(\{.+})$/;
    if (jsonRe.test(err)) {
        var msg = null;
        try {
            msg = err.match(jsonRe);
            msg = msg && msg[1];
            msg = JSON.parse(msg);
        } catch (e) {
            msg = null;
        }

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                this.gOptions.chat.chatMigrate(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (!needKick) {
        return;
    }

    this.gOptions.chat.removeChat(chatId);
    return true;
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var retryLimit = 0;

    var maxRetry = _this.gOptions.config.sendPhotoMaxRetry;
    if (maxRetry) {
        retryLimit = maxRetry;
    }

    var previewList = stream.preview;
    if (!Array.isArray(previewList)) {
        previewList = [previewList];
    }

    var sendingPic = function(index, retry) {
        var previewUrl = previewList[index];

        var sendPic = function(request) {
            return Promise.try(function() {
                return _this.gOptions.bot.sendPhoto(chatId, request, {
                    caption: text
                });
            }).then(function (msg) {
                var fileId = msg.photo[0].file_id;

                setTimeout(function() {
                    _this.track(chatId, stream, 'sendPhoto');
                });

                return fileId;
            }).catch(function(err) {
                var imgProcessError = [
                    /IMAGE_PROCESS_FAILED/,
                    /FILE_PART_0_MISSING/
                ].some(function(re) {
                    return re.test(err);
                });

                if (imgProcessError && retry < retryLimit) {
                    retry++;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, 5000);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s! %s", retry, chatId, stream._channelName, err);
                        return sendingPic(index, retry);
                    });
                }

                throw err;
            });
        };

        var onRequestCatch = function(err) {
            debug('Request photo error! %s %s %s %s', index, stream._channelName, previewUrl, err);

            index++;
            if (index >= previewList.length) {
                throw 'Request photo error!';
            }

            return sendingPic(index, retry);
        };

        return requestPromise({
            url: previewUrl,
            encoding: null,
            forever: true
        }).catch(onRequestCatch).then(function(response) {
            if (response.statusCode === 404) {
                return onRequestCatch(new Error('404'));
            }

            var image = new Buffer(response.body, 'binary');
            return sendPic(image);
        });
    };

    return sendingPic(0, 0).catch(function(err) {
        debug('Send photo file error! %s %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);

        if (isKicked) {
            throw 'Send photo file error! Bot was kicked!';
        }

        throw 'Send photo file error!';
    });
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;
    var chatId = null;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
            disable_web_page_preview: true,
            parse_mode: 'HTML'
        }).then(function() {
            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(err) {
            debug('Send text msg error! %s %s %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(err) {
            debug('Send photo msg error! %s %s %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var send = function() {
        var photoId = stream._photoId;
        var promiseList = [];

        while (chatId = chatIdList.shift()) {
            if (!photoId) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPic(chatId, photoId));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview || (Array.isArray(stream.preview) && stream.preview.length === 0)) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    var requestPicId = function() {
        if (!chatIdList.length) {
            debug('chatList is empty! %j', stream);
            return;
        }

        chatId = chatIdList.shift();

        return _this.getPicId(chatId, text, stream).then(function(fileId) {
            stream._photoId = fileId;
        }).catch(function(err) {
            if (err === 'Send photo file error! Bot was kicked!') {
                return requestPicId();
            }

            chatIdList.unshift(chatId);
            debug('Function getPicId throw error!', err);
        });
    };
    return requestPicId().then(function() {
        return send();
    });
};

Checker.prototype.onNewStream = function(stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
        if (!userChannelList) {
            continue;
        }

        if (userChannelList.indexOf(stream._channelName) === -1) {
            continue;
        }

        chatIdList.push(chatItem.chatId);
    }

    if (!chatIdList.length) {
        return;
    }

    return this.sendNotify(chatIdList, text, noPhotoText, stream);
};

Checker.prototype.notifyAll = function(streamList) {
    "use strict";
    var _this = this;

    var promiseList = [];
    streamList.forEach(function (stream) {
        promiseList.push(_this.onNewStream(stream));
    });

    return Promise.all(promiseList);
};

Checker.prototype.cleanServices = function() {
    "use strict";
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var promiseList = [];

    for (var service in serviceChannelList) {
        if (!serviceChannelList.hasOwnProperty(service)) {
            continue;
        }

        var currentService = services[service];
        if (!currentService) {
            debug('Service "%s" is not found!', service);
            continue;
        }

        var channelList = serviceChannelList[service];

        if (currentService.clean) {
            promiseList.push(currentService.clean(channelList));
        }
    }

    return Promise.all(promiseList);
};

Checker.prototype.updateList = function() {
    "use strict";
    var _this = this;
    var lastStreamList = this.gOptions.storage.lastStreamList;
    var notifyTimeout = _this.gOptions.config.notifyTimeout;

    var onGetStreamList = function(streamList) {
        var notifyList = [];
        var now = parseInt(Date.now() / 1000);
        streamList.forEach(function(item) {
            var cItem = null;

            lastStreamList.some(function(exItem, index) {
                if (exItem._service === item._service && exItem._id === item._id) {
                    cItem = exItem;
                    lastStreamList.splice(index, 1);
                    return true;
                }
            });

            if (!cItem) {
                if (item._isNotified = _this.isNotDblItem(item)) {
                    notifyList.push(item);
                    debugLog('[s]', 'Nn', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                } else {
                    debugLog('[s]', 'D-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            } else {
                item._isNotified = cItem._isNotified;
                item._notifyTimeout = cItem._notifyTimeout;
                item._createTime = cItem._createTime;

                if (item._isNotified && item._notifyTimeout < now) {
                    item._isNotified = false;
                    delete item._notifyTimeout;
                }

                if (!item._isNotified && _this.isStatusChange(cItem, item)) {
                    item._isNotified = true;
                    notifyList.push(item);
                    debugLog('[s]', 'En', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            }

            if (item._isNotified && !item._notifyTimeout) {
                item._notifyTimeout = now + notifyTimeout * 60;
            }

            lastStreamList.push(item);
        });

        return _this.notifyAll(notifyList);
    };

    this.cleanStreamList(lastStreamList);

    return base.storage.set({lastStreamList: lastStreamList}).then(function() {
        var serviceChannelList = _this.getChannelList();
        var services = _this.gOptions.services;

        var promiseList = [];

        for (var service in serviceChannelList) {
            if (!serviceChannelList.hasOwnProperty(service)) {
                continue;
            }
            (function(service){
                var currentService = services[service];
                if (!currentService) {
                    debug('Service "%s" is not found!', service);
                    return;
                }

                var channelList = serviceChannelList[service];
                while (channelList.length) {
                    var arr = channelList.splice(0, 100);
                    (function(arr) {
                        var streamListPromise = (function getStreamList(retry) {
                            return currentService.getStreamList(arr).catch(function(err) {
                                retry++;
                                if (retry >= 5) {
                                    debug("Request stream list %s error! %s", service, err);
                                    return [];
                                }

                                return new Promise(function(resolve) {
                                    setTimeout(resolve, 5 * 1000);
                                }).then(function() {
                                    debug("Retry %s request stream list %s! %s", retry, service, err);
                                    return getStreamList(retry);
                                });
                            });
                        })(0);

                        promiseList.push(streamListPromise.then(function(streamList) {
                            return onGetStreamList(streamList);
                        }));
                    })(arr);
                }
            })(service);
        }

        return Promise.all(promiseList).then(function() {
            return base.storage.set({lastStreamList: lastStreamList});
        });
    });
};

Checker.prototype.track = function(chatId, stream, title) {
    "use strict";
    return this.gOptions.tracker.track({
        text: stream._channelName,
        from: {
            id: 1
        },
        chat: {
            id: chatId
        },
        date: parseInt(Date.now() / 1000)
    }, title);
};

module.exports = Checker;