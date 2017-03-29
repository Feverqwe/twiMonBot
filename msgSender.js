/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:msgSender');
var request = require('request');
var requestPromise = require('request-promise');

var MsgSender = function (options) {
    var _this = this;
    _this.gOptions = options;
    _this.messageRequestPicturePromise = {};
};

/**
 * @param {Object} message
 * @param {number} message.chatId
 * @param {number} message.id
 * @return {Promise}
 */
MsgSender.prototype.addMsgInStream = function (message) {
    var _this = this;
    return _this.gOptions.msgStack.addStreamMessage(message);
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

MsgSender.prototype.getValidPhotoUrl = function (stream) {
    var _this = this;

    var requestLimit = _this.gOptions.config.sendPhotoRequestLimit || 10;

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
            _this.track(chatId, data, 'sendPhoto');
            return _this.addMsgInStream({
                type: 'streamPhoto',
                chatId: chatId,
                id: msg.message_id,
                streamId: data._id
            }).then(function () {
                var imageFileId = null;
                msg.photo.some(function (item) {
                    return imageFileId = item.file_id;
                });
                return imageFileId;
            });
        }, function (err) {
            any();
            throw err;
        });
        promise = promise.catch(function (err) {
            return _this.send(chatId, null, caption, text, data).then(function () {
                debug('getPicId error %o', err);
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
        _this.track(chatId, stream, 'sendMsg');
        return _this.addMsgInStream({
            type: 'streamText',
            chatId: chatId,
            id: msg.message_id,
            streamId: stream._id
        });
    });
};

MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    var _this = this;
    return _this.gOptions.bot.sendPhotoQuote(chatId, fileId, {
        caption: text
    }).then(function(msg) {
        _this.track(chatId, stream, 'sendPhoto');
        return _this.addMsgInStream({
            type: 'streamPhoto',
            chatId: chatId,
            id: msg.message_id,
            streamId: stream._id
        });
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
            return _this.gOptions.msgStack.setImageFileId(messageId, imageFileId);
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