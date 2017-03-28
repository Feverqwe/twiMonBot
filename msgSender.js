/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:msgSender');
var debugLog = require('debug')('app:msgSender:log');
debugLog.log = console.log.bind(console);
var Promise = require('bluebird');
var request = require('request');
var requestPromise = require('request-promise');

var MsgSender = function (options) {
    var _this = this;
    _this.gOptions = options;
    _this.messageRequestPicturePromise = {};

    options.events.on('updateNotify', function(streamItem) {
        _this.updateNotify(streamItem);
    });
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

MsgSender.prototype.updateMsg = function (msg, caption, text) {
    var _this = this;
    var sendPromise = Promise.resolve();
    if (msg.type === 'streamPhoto') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageCaption(caption, {
                chat_id: msg.chatId,
                message_id: msg.id
            });
        });
    } else
    if (msg.type === 'streamText') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageText(text, {
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
    var caption = base.getNowStreamPhotoText(this.gOptions, stream);
    var text = base.getNowStreamText(this.gOptions, stream);

    return _this.gOptions.users.getChatIdsByChannel(stream._service, stream._channelId).then(function (chatIdList) {
        if (!chatIdList.length) {
            return;
        }

        var msgArray = _this.getMsgFromStream(stream).slice(0);

        var promiseArr = msgArray.map(function (msg) {
            return _this.updateMsg(msg, caption, text).then(function () {
                debugLog('[update] %s %s', msg.chatId, stream._id);

                if (msg.type === 'streamPhoto') {
                    _this.track(msg.chatId, stream, 'updatePhoto');
                } else
                if (msg.type === 'streamText') {
                    _this.track(msg.chatId, stream, 'updateText');
                }
            }).catch(function (err) {
                if (err.code === 'ETELEGRAM') {
                    var body = err.response.body;
                    if (/message to edit not found/.test(body.description)) {
                        return _this.removeMsgFromStream(stream, msg);
                    } else
                    if (/message is not modified/.test(body.description)) {
                        return;
                    }
                }
                debug('Edit msg error', err);
            });
        });

        return Promise.all(promiseArr);
    });
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

    var sendingPic = function () {
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
            });
        });
    };

    return sendingPic();
};

MsgSender.prototype.requestPicId = function(chatId, messageId, caption, text, data) {
    var _this = this;

    var any = function () {
        delete _this.messageRequestPicturePromise[messageId];
    };

    var promise = _this.messageRequestPicturePromise[messageId];
    if (!promise) {
        promise = _this.messageRequestPicturePromise[messageId] = _this.getPicId(chatId, caption, data).then(function (msg) {
            any();
            _this.addMsgInStream(data, {
                type: 'streamPhoto',
                chatId: chatId,
                id: msg.message_id
            });

            _this.track(chatId, data, 'sendPhoto');

            var imageFileId = null;
            msg.photo.some(function (item) {
                return imageFileId = item.file_id;
            });
            return imageFileId;
        }, function (err) {
            any();
            throw err;
        });
        promise = promise.catch(function (err) {
            return _this.send(chatId, null, caption, text, data).then(function () {
                debug('getPicId error', err);
            });
        });
    } else {
        promise = promise.then(function (imageFileId) {
            return _this.send(chatId, imageFileId, caption, text, data).then(function () {
                return imageFileId;
            });
        }, function () {
            return _this.requestPicId(chatId, messageId, caption, text, data);
        });
    }
    return promise;
};

MsgSender.prototype.sendMsg = function(chatId, noPhotoText, stream) {
    var _this = this;
    return _this.gOptions.bot.sendMessage(chatId, noPhotoText, {
        parse_mode: 'HTML'
    }).then(function(msg) {
        _this.addMsgInStream(stream, {
            type: 'streamText',
            chatId: chatId,
            id: msg.message_id
        });

        _this.track(chatId, stream, 'sendMsg');
    });
};

MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    var _this = this;
    return _this.gOptions.bot.sendPhotoQuote(chatId, fileId, {
        caption: text
    }).then(function(msg) {
        _this.addMsgInStream(stream, {
            type: 'streamPhoto',
            chatId: chatId,
            id: msg.message_id
        });

        _this.track(chatId, stream, 'sendPhoto');
    });
};

MsgSender.prototype.send = function(chatId, imageFileId, caption, text, stream) {
    var _this = this;

    var promise;
    if (!imageFileId || !caption) {
        promise = _this.sendMsg(chatId, text, stream);
    } else {
        promise = _this.sendPhoto(chatId, imageFileId, caption, stream);
    }

    return promise;
};

MsgSender.prototype.sendMessage = function (chatId, messageId, message, data, useCache) {
    var _this = this;

    var imageFileId = message.imageFileId;
    var caption = message.caption;
    var text = message.text;

    if (!data.preview.length) {
        return _this.send(chatId, imageFileId, caption, text, data);
    }

    if (!caption) {
        return _this.send(chatId, imageFileId, caption, text, data);
    }

    if (useCache && imageFileId) {
        return _this.send(chatId, imageFileId, caption, text, data);
    }

    return _this.requestPicId(chatId, messageId, caption, text, data).then(function(imageFileId) {
        if (imageFileId) {
            message.imageFileId = imageFileId;

            data._photoId = imageFileId;
            // return _this.gOptions.msgStack.setImageFileId(messageId, imageFileId);
        }
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