/**
 * Created by Anton on 02.10.2016.
 */
var base = require('./base');
var debug = require('debug')('MsgSender');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var MsgSender = function (options) {
    "use strict";
    var _this = this;
    _this.gOptions = options;

    _this.requestPromiseMap = {};

    options.events.on('updateNotify', function(streamItem) {
        _this.updateNotify(streamItem);
    });
};

MsgSender.prototype.onSendMsgError = function(err, chatId) {
    "use strict";
    var _this = this;
    var errMsg = err.message;
    var needKick = /^403\s+/.test(errMsg);

    if (!needKick) {
        needKick = [
            /group chat is deactivated/,
            /chat not found"/,
            /channel not found"/,
            /USER_DEACTIVATED/
        ].some(function (re) {
            return re.test(errMsg);
        });
    }

    var errorJson = /^\d+\s+(\{.+})$/.exec(errMsg);
    errorJson = errorJson && errorJson[1];
    if (errorJson) {
        var msg = null;
        try {
            msg = JSON.parse(errorJson);
        } catch (e) {}

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                _this.gOptions.chat.chatMigrate(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (needKick) {
        if (/^@\w+$/.test(chatId)) {
            _this.gOptions.chat.removeChannel(chatId);
        } else {
            _this.gOptions.chat.removeChat(chatId);
        }
    }

    return needKick;
};

MsgSender.prototype.downloadImg = function (stream) {
    "use strict";
    var _this = this;

    var requestLimit = 4;
    var _requestLimit = _this.gOptions.config.sendPhotoRequestLimit;
    if (_requestLimit) {
        requestLimit = _requestLimit;
    }

    var requestTimeoutSec = 0.25;
    var _requestTimeoutSec = _this.gOptions.config.sendPhotoRequestTimeoutSec;
    if (_requestTimeoutSec) {
        requestTimeoutSec = _requestTimeoutSec;
    }
    requestTimeoutSec *= 1000;

    var previewList = stream.preview;

    var requestPic = function (index) {
        var previewUrl = previewList[index];
        return requestPromise({
            method: 'HEAD',
            url: previewUrl,
            gzip: true,
            forever: true
        }).then(function (response) {
            if (response.statusCode !== 200) {
                throw new Error(response.statusCode);
            }

            return response.request.href;
        }).catch(function(err) {
            // debug('Request photo error! %s %s %s', index, stream._channelId, previewUrl, err);

            index++;
            if (index < previewList.length) {
                return requestPic(index);
            }

            requestLimit--;
            if (requestLimit > 0) {
                return new Promise(function(resolve) {
                    setTimeout(resolve, requestTimeoutSec);
                }).then(function() {
                    // debug("Retry %s request photo %s %s!", requestLimit, chatId, stream._channelId, err);
                    return requestPic(0);
                });
            }

            throw err;
        });
    };

    return requestPic(0).catch(function (err) {
        debug('requestPic error %s', stream._channelId, err);

        throw err;
    });
};

MsgSender.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;

    var sendPicLimit = 0;
    var _retryLimit = _this.gOptions.config.sendPhotoMaxRetry;
    if (_retryLimit) {
        sendPicLimit = _retryLimit;
    }

    var sendPicTimeoutSec = 5;
    var _retryTimeoutSec = _this.gOptions.config.sendPhotoRetryTimeoutSec;
    if (_retryTimeoutSec) {
        sendPicTimeoutSec = _retryTimeoutSec;
    }
    sendPicTimeoutSec *= 1000;

    var sendingPic = function() {
        var sendPic = function(photoUrl) {
            return _this.gOptions.bot.sendPhotoUrl(chatId, photoUrl, {
                caption: text
            }).catch(function(err) {
                var isKicked = _this.onSendMsgError(err, chatId);
                if (isKicked) {
                    throw new Error('Send photo file error! Bot was kicked!');
                }

                var imgProcessError = [
                    /Failed to get HTTP URL content/
                ].some(function(re) {
                    return re.test(err);
                });

                sendPicLimit--;
                if (imgProcessError && sendPicLimit > 0) {
                    return new Promise(function(resolve) {
                        setTimeout(resolve, sendPicTimeoutSec);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s!", sendPicLimit, chatId, stream._channelId, err);
                        return sendingPic();
                    });
                }

                debug('sendPic error %s %s %s', chatId, stream._channelId, photoUrl, err);

                throw err;
            });
        };

        return _this.downloadImg(stream).then(function (photoUrl) {
            return sendPic(photoUrl);
        });
    };

    return sendingPic();
};

/**
 * @param {Object} stream
 * @param {Object} msg
 * @param {number} msg.chatId
 * @param {number} msg.id
 */
MsgSender.prototype.addMsgInStream = function (stream, msg) {
    "use strict";
    var msgArray = stream.msgArray;
    if (!msgArray) {
        msgArray = stream.msgArray = [];
    }
    msgArray.push(msg);

    var chatMsgList = msgArray.filter(function (item) {
        return item.chatId === msg.chatId;
    }).reverse();

    var limit = 20;
    if (chatMsgList.length > limit) {
        chatMsgList.slice(limit).forEach(function (item) {
            base.removeItemFromArray(msgArray, item);
        });
    }

    this.gOptions.events.emit('saveStreamList');
};

MsgSender.prototype.getMsgFromStream = function (stream) {
    "use strict";
    return stream.msgArray || [];
};

MsgSender.prototype.removeMsgFromStream = function (stream, msg) {
    "use strict";
    var msgArray = this.getMsgFromStream(stream);
    var pos = msgArray.indexOf(msg);
    if (pos !== -1) {
        msgArray.splice(pos, 1);
    }

    this.gOptions.events.emit('saveStreamList');
};

MsgSender.prototype.getStreamChatIdList = function (stream) {
    "use strict";
    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    Object.keys(chatList).forEach(function (chatId) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
        if (!userChannelList) {
            return;
        }

        if (userChannelList.indexOf(stream._channelId) === -1) {
            return;
        }

        chatIdList.push(chatItem.chatId);
    });

    return chatIdList;
};

MsgSender.prototype.updateMsg = function (msg, text, noPhotoText) {
    "use strict";
    var _this = this;
    var sendPromise = Promise.resolve();
    if (msg.type === 'streamPhoto') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageCaption(
                msg.chatId,
                text,
                {
                    message_id: msg.id
                }
            );
        });
    } else
    if (msg.type === 'streamText') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageText(
                msg.chatId,
                noPhotoText,
                {
                    message_id: msg.id,
                    parse_mode: 'HTML'
                }
            );
        });
    }
    return sendPromise;
};

MsgSender.prototype.updateNotify = function (stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    var chatIdList = this.getStreamChatIdList(stream);

    if (!chatIdList.length) {
        return Promise.resolve();
    }

    var msgArray = this.getMsgFromStream(stream).slice(0);

    var promiseArr = msgArray.map(function (msg) {
        return _this.updateMsg(msg, text, noPhotoText).then(function () {
            if (msg.type === 'streamPhoto') {
                _this.track(msg.chatId, stream, 'updatePhoto');
            } else
            if (msg.type === 'streamText') {
                _this.track(msg.chatId, stream, 'updateText');
            }
        }).catch(function (e) {
            var errMsg = e.message;
            if (/message not found/.test(errMsg)) {
                _this.removeMsgFromStream(stream, msg);
            } else
            if (!/message is not modified/.test(errMsg)) {
                debug('Edit msg error', e);
            }
        });
    });

    return Promise.all(promiseArr);
};

MsgSender.prototype.sendMsg = function(chatId, noPhotoText, stream) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;

    return bot.sendMessage(chatId, noPhotoText, {
        parse_mode: 'HTML'
    }).then(function(msg) {
        _this.addMsgInStream(stream, {
            type: 'streamText',
            chatId: chatId,
            id: msg.message_id
        });

        _this.track(chatId, stream, 'sendMsg');
    }).catch(function(err) {
        debug('Send text msg error! %s %s', chatId, stream._channelId, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;

    return bot.sendPhotoQuote(chatId, fileId, {
        caption: text
    }).then(function(msg) {
        _this.addMsgInStream(stream, {
            type: 'streamPhoto',
            chatId: chatId,
            id: msg.message_id
        });

        _this.track(chatId, stream, 'sendPhoto');
    }).catch(function(err) {
        debug('Send photo msg error! %s %s', chatId, stream._channelId, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

MsgSender.prototype.send = function(chatIdList, text, noPhotoText, stream) {
    "use strict";
    var _this = this;
    var photoId = stream._photoId;
    var promiseList = [];

    var chatId = null;
    while (chatId = chatIdList.shift()) {
        if (!photoId || !text) {
            promiseList.push(_this.sendMsg(chatId, noPhotoText, stream));
        } else {
            promiseList.push(_this.sendPhoto(chatId, photoId, text, stream));
        }
    }

    return Promise.all(promiseList);
};

MsgSender.prototype.requestPicId = function(chatIdList, text, stream) {
    var _this = this;
    var requestPromiseMap = _this.requestPromiseMap;
    var requestId = stream._id;

    if (!chatIdList.length) {
        // debug('chatList is empty! %j', stream);
        return Promise.resolve();
    }

    var promise = requestPromiseMap[requestId];
    if (promise) {
        promise = promise.then(function (msg) {
            stream._photoId = msg.photo[0].file_id;
        }).catch(function(err) {
            if (err.message === 'Send photo file error! Bot was kicked!') {
                return _this.requestPicId(chatIdList, text, stream);
            }
        });
    } else {
        var chatId = chatIdList.shift();

        var requestPromise = requestPromiseMap[requestId] = _this.getPicId(chatId, text, stream).finally(function () {
            if (requestPromiseMap[requestId] === requestPromise) {
                delete requestPromiseMap[requestId];
            }
        });

        promise = requestPromise.then(function (msg) {
            _this.addMsgInStream(stream, {
                type: 'streamPhoto',
                chatId: chatId,
                id: msg.message_id
            });

            stream._photoId = msg.photo[0].file_id;

            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function (err) {
            if (err.message === 'Send photo file error! Bot was kicked!') {
                return _this.requestPicId(chatIdList, text, stream);
            }

            chatIdList.unshift(chatId);
            // debug('Function getPicId throw error!', err);
        });
    }

    return promise;
};

MsgSender.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;

    if (!stream.preview.length) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    if (!text) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    if (useCache && stream._photoId) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    return _this.requestPicId(chatIdList, text, stream).then(function() {
        return _this.send(chatIdList, text, noPhotoText, stream);
    });
};

MsgSender.prototype.track = function(chatId, stream, title) {
    "use strict";
    return this.gOptions.tracker.track({
        text: stream._channelId,
        from: {
            id: 1
        },
        chat: {
            id: chatId
        },
        date: base.getNow()
    }, title);
};

module.exports = MsgSender;