/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');
var request = require('request');
var requestPromise = Promise.promisify(request);

var streamLog = true;

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList();
    });
};

Checker.prototype.cleanStreamList = function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);

    for (var i = 0, item; item = streamList[i]; i++) {
        if (now - item._addItemTime > this.gOptions.config.timeout && item._isOffline) {
            rmList.push(item);
            streamLog && debug('[s]', base.getDate(), 'R-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
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

Checker.prototype.onSendMsgError = function(e, chatId) {
    var errorMsg = e && e.message || '';

    var isError = [
        'Bot was kicked from a chat',
        'Bad Request: wrong chat id',
        'PEER_ID_INVALID',
        'chat not found'
    ].some(function(desc) {
        if (errorMsg.indexOf(desc) !== -1) {
            return true;
        }
    });

    if (!isError) {
        return;
    }

    var needSave = false;
    var storage = this.gOptions.storage;
    for (var _chatId in storage.chatList) {
        var item = storage.chatList[_chatId];
        if (item.chatId === chatId) {
            debug(base.getDate(), 'Remove chat', chatId, '\n', JSON.stringify(item));

            delete storage.chatList[_chatId];

            needSave = true;
        }
    }

    needSave && base.storage.set({chatList: storage.chatList});
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var sendPic = function(chatId, request) {
        return _this.gOptions.bot.sendPhoto(chatId, request, {
            caption: text
        }).then(function (msg) {
            var fileId = msg.photo[0].file_id;

            setTimeout(function() {
                _this.track(chatId, stream, 'sendPhoto');
            });

            return fileId;
        }).catch(function(e) {
            debug(base.getDate(), 'Send photo error!', chatId, stream._channelName, '\n', e && e.message);

            _this.onSendMsgError(e, chatId);

            throw new Error('Sent msg with photo file error!');
        });
    };

    return new Promise(function(resolve, reject) {
        var req = request(stream.preview);
        req.on('error', function() {
            console.error(base.getDate(), 'Request photo error!', stream._channelName, '\n', stream.preview);
            return reject();
        });

        resolve(sendPic);
    });
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;
    var chatId = null;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
            parse_mode: 'Markdown'
        }).then(function() {
            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(e) {
            debug(base.getDate(), 'Send text msg error!', chatId, stream._channelName, '\n', e && e.message);

            _this.onSendMsgError(e, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(e) {
            debug(base.getDate(), 'Send photo msg error!', chatId, stream._channelName, '\n', e && e.message);

            _this.onSendMsgError(e, chatId);
        });
    };

    var send = function() {
        var hasPhoto = stream._photoId;
        var promiseList = [];

        while (chatId = chatIdList.shift()) {
            if (!hasPhoto) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPic(chatId, hasPhoto));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    return new Promise(function(resolve) {
        chatId = chatIdList.shift();
        _this.getPicId(chatId, text, stream).then(function(fileId) {
            stream._photoId = fileId;
        }).catch(function() {
            chatIdList.unshift(chatId);
        }).finally(function() {
            return resolve(send());
        });
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
    return Promise.resolve().then(function() {
        var promiseList = [];
        streamList.forEach(function (stream) {
            promiseList.push(_this.onNewStream(stream));
        });
        return Promise.all(promiseList);
    });
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
                    streamLog && debug('[s]', base.getDate(), 'Nn', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                } else {
                    streamLog && debug('[s]', base.getDate(),'D-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
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
                    streamLog && debug('[s]', base.getDate(),'En', item._service, item._channelName, '#', item.channel.status, '#', item.game);
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
            if (!services[service]) {
                debug(base.getDate(), 'Service is not found!', service);
                continue;
            }

            var channelList = serviceChannelList[service];
            while (channelList.length) {
                var arr = channelList.splice(0, 100);
                promiseList.push(services[service].getStreamList(arr).then(function(streamList) {
                    return onGetStreamList(streamList);
                }));
            }
        }

        return Promise.all(promiseList).then(function() {
            return base.storage.set({lastStreamList: lastStreamList});
        });
    });
};

Checker.prototype.track = function(chatId, stream, title) {
    "use strict";
    try {
        this.gOptions.botan.track({
            text: stream._channelName,
            from: {
                id: 1
            },
            chat: {
                id: chatId
            },
            date: parseInt(Date.now() / 1000)
        }, title);
    } catch(e) {
        console.error(base.getDate(), 'Botan track error', e.message);
    }
};

module.exports = Checker;