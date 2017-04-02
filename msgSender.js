/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
const base = require('./base');
const debug = require('debug')('app:msgSender');
const request = require('request');
const requestPromise = require('request-promise');

var MsgSender = function (options) {
    var _this = this;
    _this.gOptions = options;
    _this.messageRequestPicturePromise = {};
};

/**
 * @param {Object} message
 * @param {String} message.type
 * @param {String} message.chat_id
 * @param {String} message.streamId
 * @param {String} message.chatId
 * @param {String} message.id
 * @return {Promise}
 */
MsgSender.prototype.addMsgInStream = function (message) {
    var _this = this;
    return _this.gOptions.msgStack.addStreamMessage(message);
};

/**
 * @param {Object} msg
 * @param {String} caption
 * @param {String} text
 * @return {Promise}
 */
MsgSender.prototype.updateMsg = function (msg, caption, text) {
    var _this = this;
    var sendPromise = Promise.resolve();
    if (msg.type === 'streamPhoto') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageCaption(caption, {
                chat_id: msg.chat_id,
                message_id: msg.id
            });
        });
    } else
    if (msg.type === 'streamText') {
        sendPromise = sendPromise.then(function () {
            return _this.gOptions.bot.editMessageText(text, {
                chat_id: msg.chat_id,
                message_id: msg.id,
                parse_mode: 'HTML'
            });
        });
    }
    return sendPromise;
};

/**
 * @param {Object} stream
 */
MsgSender.prototype.getValidPhotoUrl = function (stream) {
    var _this = this;

    var requestLimit = _this.gOptions.config.sendPhotoRequestLimit || 4;

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
                setTimeout(resolve, 250);
            }).then(function() {
                return getHead(0);
            });
        });
    };

    return getHead(0);
};

/**
 * @param {String} chatId
 * @param {String} text
 * @param {Object} stream
 * @return {Promise}
 */
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

/**
 * @param {String} chat_id
 * @param {String} messageId
 * @param {String} caption
 * @param {String} text
 * @param {Object} data
 * @param {String} chatId
 * @return {Promise}
 */
MsgSender.prototype.requestPicId = function(chat_id, messageId, caption, text, data, chatId) {
    var _this = this;

    var any = function () {
        delete _this.messageRequestPicturePromise[messageId];
    };

    var promise = _this.messageRequestPicturePromise[messageId];
    if (!promise) {
        promise = _this.messageRequestPicturePromise[messageId] = _this.getPicId(chat_id, caption, data).then(function (msg) {
            any();
            _this.track(chat_id, data, 'sendPhoto');
            return _this.addMsgInStream({
                type: 'streamPhoto',
                chat_id: chat_id,
                id: msg.message_id,
                streamId: data._id,
                chatId: chatId
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
            return _this.send(chat_id, null, caption, text, data, chatId).then(function () {
                debug('getPicId error %o', err);
            });
        });
    } else {
        promise = promise.then(function (imageFileId) {
            return _this.send(chat_id, imageFileId, caption, text, data, chatId).then(function () {
                return imageFileId;
            });
        }, function () {
            return _this.requestPicId(chat_id, messageId, caption, text, data, chatId);
        });
    }
    return promise;
};

/**
 * @param {String} chat_id
 * @param {String} noPhotoText
 * @param {Object} stream
 * @param {String} chatId
 * @return {Promise}
 */
MsgSender.prototype.sendMsg = function(chat_id, noPhotoText, stream, chatId) {
    var _this = this;
    return _this.gOptions.bot.sendMessage(chat_id, noPhotoText, {
        parse_mode: 'HTML'
    }).then(function(msg) {
        _this.track(chat_id, stream, 'sendMsg');
        return _this.addMsgInStream({
            type: 'streamText',
            chat_id: chat_id,
            id: msg.message_id,
            streamId: stream._id,
            chatId: chatId
        });
    });
};

/**
 * @param {String} chat_id
 * @param {String} fileId
 * @param {String} text
 * @param {Object} stream
 * @param {String} chatId
 * @return {Promise}
 */
MsgSender.prototype.sendPhoto = function(chat_id, fileId, text, stream, chatId) {
    var _this = this;
    return _this.gOptions.bot.sendPhotoQuote(chat_id, fileId, {
        caption: text
    }).then(function(msg) {
        _this.track(chat_id, stream, 'sendPhoto');
        return _this.addMsgInStream({
            type: 'streamPhoto',
            chat_id: chat_id,
            id: msg.message_id,
            streamId: stream._id,
            chatId: chatId
        });
    });
};

/**
 * @param {String} chat_id
 * @param {String|null} imageFileId
 * @param {String} caption
 * @param {String} text
 * @param {Object} stream
 * @param {String} chatId
 * @return {Promise}
 */
MsgSender.prototype.send = function(chat_id, imageFileId, caption, text, stream, chatId) {
    var _this = this;

    var promise;
    if (!imageFileId || !caption) {
        promise = _this.sendMsg(chat_id, text, stream, chatId);
    } else {
        promise = _this.sendPhoto(chat_id, imageFileId, caption, stream, chatId);
    }

    return promise;
};

/**
 * @param {String} chat_id
 * @param {String} messageId
 * @param {Object} message
 * @param {Object} data
 * @param {Boolean} useCache
 * @param {String} chatId
 * @return {Promise}
 */
MsgSender.prototype.sendMessage = function (chat_id, messageId, message, data, useCache, chatId) {
    var _this = this;

    var imageFileId = message.imageFileId;
    var caption = message.caption;
    var text = message.text;

    if (!data.preview.length) {
        return _this.send(chat_id, imageFileId, caption, text, data, chatId);
    }

    if (!caption) {
        return _this.send(chat_id, imageFileId, caption, text, data, chatId);
    }

    if (useCache && imageFileId) {
        return _this.send(chat_id, imageFileId, caption, text, data, chatId);
    }

    return _this.requestPicId(chat_id, messageId, caption, text, data, chatId).then(function(imageFileId) {
        if (imageFileId) {
            message.imageFileId = imageFileId;
            return _this.gOptions.msgStack.setImageFileId(messageId, imageFileId);
        }
    });
};

/**
 * @param {String} chatId
 * @param {Object} stream
 * @param {String} title
 */
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