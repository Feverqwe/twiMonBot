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
 * @param {Object} msg
 * @param {string} caption
 * @param {string} text
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

/**
 * @param {string} chat_id
 * @param {string} text
 * @param {Object} stream
 * @return {Promise}
 */
MsgSender.prototype.getPicId = function(chat_id, text, stream) {
    var _this = this;

    var sendingPic = function () {
        var uploadPhoto = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chat_id, request({
                url: photoUrl,
                forever: true
            }), {
                caption: text
            });
        };

        var sendPhotoUrl = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chat_id, photoUrl, {
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
 * @param {string} chat_id
 * @param {string} messageId
 * @param {string} caption
 * @param {string} text
 * @param {Object} data
 * @return {Promise}
 */
MsgSender.prototype.requestPicId = function(chat_id, messageId, caption, text, data) {
    var _this = this;

    var any = function () {
        delete _this.messageRequestPicturePromise[messageId];
    };

    var promise = _this.messageRequestPicturePromise[messageId];
    if (!promise) {
        promise = _this.messageRequestPicturePromise[messageId] = _this.getPicId(chat_id, caption, data).then(function (msg) {
            any();
            return msg;
        }, function (err) {
            any();
            throw err;
        });
        promise = promise.catch(function (err) {
            return _this.send(chat_id, null, caption, text).then(function (msg) {
                debug('getPicId error %o', err);
                return msg;
            });
        });
    } else {
        promise = promise.then(function (msg) {
            var imageFileId = null;
            msg.photo.some(function (item) {
                return imageFileId = item.file_id;
            });

            return _this.send(chat_id, imageFileId, caption, text);
        }, function (err) {
            return _this.requestPicId(chat_id, messageId, caption, text, data);
        });
    }
    return promise;
};

/**
 * @param {string} chat_id
 * @param {string|null} imageFileId
 * @param {string} caption
 * @param {string} text
 * @return {Promise}
 */
MsgSender.prototype.send = function(chat_id, imageFileId, caption, text) {
    var _this = this;

    if (!imageFileId || !caption) {
        return _this.gOptions.bot.sendMessage(chat_id, text, {
            parse_mode: 'HTML'
        });
    } else {
        return _this.gOptions.bot.sendPhotoQuote(chat_id, imageFileId, {
            caption: caption
        });
    }
};

/**
 * @param {string} chat_id
 * @param {string} messageId
 * @param {Object} message
 * @param {Object} data
 * @param {Boolean} useCache
 * @return {Promise}
 */
MsgSender.prototype.sendMessage = function (chat_id, messageId, message, data, useCache) {
    var _this = this;

    var imageFileId = message.imageFileId;
    var caption = message.caption;
    var text = message.text;

    if (!data.preview.length) {
        return _this.send(chat_id, imageFileId, caption, text);
    }

    if (!caption) {
        return _this.send(chat_id, imageFileId, caption, text);
    }

    if (useCache && imageFileId) {
        return _this.send(chat_id, imageFileId, caption, text);
    }

    return _this.requestPicId(chat_id, messageId, caption, text, data).then(function (msg) {
        var promise = Promise.resolve();

        var imageFileId = null;
        msg.photo && msg.photo.sort(function (a, b) {
            return a.file_size > b.file_size ? - 1 : 1;
        }).some(function (item) {
            return imageFileId = item.file_id;
        });
        if (imageFileId) {
            message.imageFileId = imageFileId;
            promise = promise.then(function () {
                return _this.gOptions.msgStack.setImageFileId(messageId, imageFileId);
            });
        }

        return promise.then(function () {
            return msg;
        });
    });
};


module.exports = MsgSender;