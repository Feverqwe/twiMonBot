/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');

var streamLog = true;

var Checker = function(options) {
    "use strict";
    this.gOptions = options;
};

Checker.prototype.cleanStreamList = function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);

    for (var i = 0, item; item = streamList[i]; i++) {
        if (now - item._addItemTime > this.gOptions.config.timeout && item._isOffline) {
            rmList.push(item);
            streamLog && console.log('[s]', base.getDate(), 'R-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
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
    var errorMsg = e && e.message || '<not error msg>';

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
            console.error(base.getDate(), 'Remove chat', chatId, '\n', JSON.stringify(item));
            delete storage.chatList[_chatId];
            needSave = true;
        }
    }

    needSave &&  base.storage.set({chatList: storage.chatList});
};

Checker.prototype.getPicId = function(chatId, text, stream, onReady) {
    "use strict";
    var sendPic = function(chatId, request) {
        return this.gOptions.bot.sendPhoto(chatId, request, {
            caption: text
        }).then(function (msg) {
            var fileId = msg && msg.photo && msg.photo[0] && msg.photo[0].file_id;

            onReady(fileId);

            this.track(chatId, stream, 'sendPhoto');
        }.bind(this)).catch(function(e) {
            console.error(base.getDate(), 'Send msg with photo error!', chatId, stream._channelName, '\n', e && e.message);
            if (/socket hang up/.test(e && e.message)) {
                console.error(base.getDate(), 'Stream preview url', stream.preview);
            }

            this.onSendMsgError(e, chatId);

            onReady();
        }.bind(this));
    }.bind(this);

    try {
        var request = require("request");
        var req = request(stream.preview);

        req.on('error', function() {
            console.error(base.getDate(), 'Request photo error!', stream._channelName, '\n', stream.preview);
            return onReady();
        });

        sendPic(chatId, req);
    } catch(e) {
        console.error(base.getDate(), 'Request photo exception!', stream._channelName, '\n', e.message);
        return onReady();
    }
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    var sendMsg = function(chatId) {
        this.gOptions.bot.sendMessage(chatId, noPhotoText, {
            parse_mode: 'Markdown'
        }).then(function() {
            this.track(chatId, stream, 'sendMsg');
        }.bind(this)).catch(function(e) {
            console.error(base.getDate(), 'Send msg without photo error!', chatId, stream._channelName, '\n', e && e.message);

            this.onSendMsgError(e, chatId);
        }.bind(this));
    }.bind(this);

    var sendPic = function(chatId, fileId) {
        this.gOptions.bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            this.track(chatId, stream, 'sendPhoto');
        }.bind(this)).catch(function(e) {
            console.error(base.getDate(), 'Send msg with photo id error!', chatId, stream._channelName, '\n', e && e.message);

            this.onSendMsgError(e, chatId);
        }.bind(this));
    }.bind(this);

    var onError = function() {
        console.error(base.getDate(), 'Sending msg without photo!', stream._channelName);
        while (chatId = chatIdList.shift()) {
            sendMsg(chatId);
        }
    };

    if (!stream.preview) {
        return onError();
    }

    if (useCache && stream._photoId) {
        while (chatId = chatIdList.shift()) {
            sendPic(chatId, stream._photoId);
        }
        return;
    }

    var chatId = chatIdList.shift();
    var fired = false;
    return this.getPicId(chatId, text, stream, function(fileId) {
        if (fired) {
            console.error(base.getDate(), 'Dbl fire getPicId!');
            return;
        }
        fired = true;

        if (!fileId) {
            chatIdList.unshift(chatId);
            return onError();
        }

        stream._photoId = fileId;

        while (chatId = chatIdList.shift()) {
            sendPic(chatId, fileId);
        }
    });
};

Checker.prototype.getNowStreamPhotoText = function(stream) {
    "use strict";
    var textArr = [];

    var line = [];
    if (stream.channel.status) {
        line.push(stream.channel.status);
    }
    if (stream.game) {
        line.push(stream.game);
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    if (stream.channel.url) {
        textArr.push(stream.channel.url);
    }

    return textArr.join('\n');
};

Checker.prototype.getNowStreamText = function(stream) {
    "use strict";
    var textArr = [];

    var line = [];
    if (stream.channel.status) {
        line.push(base.markDownSanitize(stream.channel.status));
    }
    if (stream.game) {
        line.push('_'+base.markDownSanitize(stream.game)+'_');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (stream.channel.url) {
        var channelName = '*' + base.markDownSanitize(stream.channel.display_name || stream.channel.name) + '*';
        line.push(this.gOptions.language.watchOn
            .replace('{channelName}', channelName)
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

Checker.prototype.onNewStream = function(stream) {
    "use strict";
    var text = this.getNowStreamPhotoText(stream);
    var noPhotoText = this.getNowStreamText(stream);

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

    chatIdList.length && this.sendNotify(chatIdList, text, noPhotoText, stream);
};

Checker.prototype.updateList = function(cb) {
    "use strict";
    var lastStreamList = this.gOptions.config.lastStreamList;
    this.cleanStreamList(lastStreamList);

    var streamList = [];

    var waitCount = 0;
    var readyCount = 0;
    var onReady = function(streams) {
        readyCount++;

        if (streams && streams.length) {
            streamList.push.apply(streamList, streams);
        }

        if (readyCount !== waitCount) {
            return;
        }

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
                if (item._isNotified = this.isNotDblItem(item)) {
                    this.onNewStream(item);
                    streamLog && console.log('[s]', base.getDate(), 'Nn', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                } else {
                    streamLog && console.log('[s]', base.getDate(),'D-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            } else {
                item._isNotified = cItem._isNotified;
                item._notifyTimeout = cItem._notifyTimeout;
                item._createTime = cItem._createTime;

                if (item._isNotified && item._notifyTimeout < now) {
                    item._isNotified = false;
                    delete item._notifyTimeout;
                }

                if (!item._isNotified && this.isStatusChange(cItem, item)) {
                    item._isNotified = true;
                    this.onNewStream(item);
                    streamLog && console.log('[s]', base.getDate(),'En', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            }

            if (item._isNotified && !item._notifyTimeout) {
                item._notifyTimeout = now + this.gOptions.config.notifyTimeout * 60;
            }

            lastStreamList.push(item);
        }.bind(this));

        base.storage.set({lastStreamList: lastStreamList}, function() {
            cb && cb();
        });
    }.bind(this);

    var serviceChannelList = this.getChannelList();

    for (var service in serviceChannelList) {
        if (!this.gOptions.services[service]) {
            console.error(base.getDate(), 'Service is not found!', service);
            continue;
        }

        var channelList = serviceChannelList[service];
        while (channelList.length) {
            var arr = channelList.splice(0, 100);
            waitCount++;
            this.gOptions.services[service].getStreamList(arr, function(streams) {
                onReady(streams);
            });
        }
    }

    waitCount++;
    base.storage.set({lastStreamList: lastStreamList}).then(function() {
        onReady();
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