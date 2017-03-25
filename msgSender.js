/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:msgSender');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = require('request-promise');

var MsgSender = function (options) {
    var _this = this;
    _this.gOptions = options;

    _this.requestPromiseMap = {};

    options.events.on('updateNotify', function(streamItem) {
        _this.updateNotify(streamItem);
    });
};

MsgSender.prototype.onSendMsgError = function(err, chatId) {
    var _this = this;
    var isBlocked = false;

    if (err.code === 'ETELEGRAM') {
        var body = err.response.body;

        isBlocked = body.error_code === 403;
        if (!isBlocked) {
            isBlocked = [
                /group chat is deactivated/,
                /chat not found/,
                /channel not found/,
                /USER_DEACTIVATED/
            ].some(function (re) {
                return re.test(body.description);
            });
        }


        var isChannel = /^@\w+$/.test(chatId);
        if (isBlocked) {
            if (isChannel) {
                // todo: fix me
                _this.gOptions.users.removeChannel(chatId);
            } else {
                // todo: fix me
                _this.gOptions.users.removeChat(chatId);
            }
        } else
        if (!isChannel && body.parameters && body.parameters.migrate_to_chat_id) {
            // todo: fix me
            _this.gOptions.users.changeChatId(chatId, body.parameters.migrate_to_chat_id);
        }
    }

    return isBlocked;
};

MsgSender.prototype.getValidPhotoUrl = function (stream) {
    var _this = this;

    var requestLimit = _this.gOptions.config.sendPhotoRequestLimit || 4;

    var requestTimeoutSec = _this.gOptions.config.sendPhotoRequestTimeoutSec || 30;
    requestTimeoutSec *= 1000;

    var previewList = stream.preview;

    var getHead = function (index) {
        var previewUrl = previewList[index];
        return requestPromise({
            method: 'HEAD',
            url: previewUrl,
            gzip: true,
            forever: true,
            resolveWithFullResponse: true
        }).then(function (response) {
            return response.request.href;
        }).catch(function(err) {
            if (++index < previewList.length) {
                return getHead(index);
            }

            if (requestLimit-- < 1) {
                throw err;
            }

            return new Promise(function(resolve) {
                setTimeout(resolve, requestTimeoutSec);
            }).then(function() {
                return getHead(0);
            });
        });
    };

    return getHead(0);
};

MsgSender.prototype.getPicId = function(chatId, text, stream) {
    var _this = this;

    var sendingPic = function() {
        var uploadPhoto = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chatId, request({
                url: photoUrl,
                forever: true
            }), {
                caption: text
            });
        };

        var sendPhotoUrl = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chatId, photoUrl, {
                caption: text
            });
        };

        return _this.getValidPhotoUrl(stream).then(function (photoUrl) {
            return sendPhotoUrl(photoUrl).catch(function (err) {
                var errList = [
                    /failed to get HTTP URL content/,
                    /wrong type of the web page content/,
                    /wrong file identifier\/HTTP URL specified/
                ];
                var isLoadUrlError = errList.some(function (re) {
                    return re.test(err.message);
                });
                if (!isLoadUrlError) {
                    isLoadUrlError = err.response && err.response.statusCode === 504;
                }

                if (!isLoadUrlError) {
                    throw err;
                }

                return uploadPhoto(photoUrl);
            }).catch(function (err) {
                var isKicked = _this.onSendMsgError(err, chatId);
                if (isKicked) {
                    throw new Error('Send photo file error! Bot was kicked!');
                } else {
                    throw err;
                }
            });
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
    return stream.msgArray || [];
};

MsgSender.prototype.removeMsgFromStream = function (stream, msg) {
    var msgArray = this.getMsgFromStream(stream);
    var pos = msgArray.indexOf(msg);
    if (pos !== -1) {
        msgArray.splice(pos, 1);
    }

    this.gOptions.events.emit('saveStreamList');
};

MsgSender.prototype.updateMsg = function (msg, text, noPhotoText) {
    var _this = this;
    var sendPromise = Promise.resolve();
    if (msg.type === 'streamPhoto') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageCaption(text, {
                chat_id: msg.chatId,
                message_id: msg.id
            });
        });
    } else
    if (msg.type === 'streamText') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageText(noPhotoText, {
                chat_id: msg.chatId,
                message_id: msg.id,
                parse_mode: 'HTML'
            });
        });
    }
    return sendPromise;
};

MsgSender.prototype.updateNotify = function (stream) {
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    return _this.gOptions.users.getChatIdsByChannel(stream._service, stream._channelId).then(function (chatIdList) {
        if (!chatIdList.length) {
            return;
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
    });
};

MsgSender.prototype.sendMsg = function(chatId, noPhotoText, stream) {
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