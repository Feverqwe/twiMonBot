/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('MsgStack');
var Promise = require('bluebird');

var MsgStack = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.promiseChatIdMap = {};

    options.events.on('notify', function (stream) {
        return _this.notify(stream);
    });

    this.onReady = base.storage.get(['chatMsgStack']).then(function(storage) {
        _this.config.chatMsgStack = storage.chatMsgStack || {};
        _this.stack = _this.initStack();
    });
};

MsgStack.prototype.initStack = function () {
    var msgStackObj = this.gOptions.storage.lastStreamList;
    return {
        getItem: function (msgId) {
            var msg = null;
            msgStackObj.some(function (_msg) {
                if (_msg._id === msgId) {
                    msg = _msg;
                    return true;
                }
            });
            return msg;
        }
    }
};

MsgStack.prototype.getChatIdList = function (videoItem) {
    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    Object.keys(chatList).forEach(function (chatId) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[videoItem._service];
        if (!userChannelList) {
            return;
        }

        if (userChannelList.indexOf(videoItem._channelId) === -1) {
            return;
        }

        chatIdList.push(chatItem.chatId);
    });

    return chatIdList;
};

MsgStack.prototype.addInStack = function (videoItem) {
    var chatMsgStack = this.config.chatMsgStack;

    var msgId = videoItem._id;

    this.getChatIdList(videoItem).forEach(function (chatId) {
        var msgStack = base.getObjectItem(chatMsgStack, chatId, {});
        var msgList = base.getObjectItem(msgStack, 'stack', []);
        base.removeItemFromArray(msgList, msgId);
        msgList.push(msgId);
    });
};

MsgStack.prototype.clear = function () {
    var _this = this;
    var chatMsgStack = this.config.chatMsgStack;
    var chatList = this.gOptions.storage.chatList;

    Object.keys(chatMsgStack).forEach(function (chatId) {
        if (!chatList[chatId]) {
            delete chatMsgStack[chatId];
        }
    });
};

MsgStack.prototype.callMsgList = function (chatId) {
    var _this = this;
    var chatMsgStack = this.config.chatMsgStack;

    var msgStack = chatMsgStack[chatId];
    if (!msgStack) {
        return Promise.resolve();
    }

    if (msgStack.timeout > base.getNow()) {
        return Promise.resolve();
    }

    var msgList = msgStack.stack || [];
    var sendNextMsg = function () {
        if (!msgList.length) {
            delete chatMsgStack[chatId];
            return Promise.resolve();
        }

        return Promise.try(function () {
            var msgId = msgList[0];
            var chatList = [];
            var videoItem = _this.stack.getItem(msgId);
            if (!videoItem) {
                debug('VideoItem is not found! %s %s', msgId, chatId);
                base.removeItemFromArray(msgList, msgId);
                return;
            }

            var chatItem = _this.gOptions.storage.chatList[chatId];
            if (!chatItem) {
                debug('chatItem is not found! %s %s', chatId, msgId);
                throw new Error('chatItem is not found!');
            }

            var options = chatItem.options || {};

            var text = null;
            if (!options.hidePreview) {
                text = base.getNowStreamPhotoText(_this.gOptions, videoItem);
            }
            var noPhotoText = base.getNowStreamText(_this.gOptions, videoItem);

            if (options.channel) {
                !options.mute && chatList.push(chatItem.chatId);
                chatList.push(options.channel);
            } else {
                chatList.push(chatItem.chatId);
            }

            return _this.gOptions.msgSender.sendNotify(chatList, text, noPhotoText, videoItem, true).then(function () {
                base.removeItemFromArray(msgList, msgId);
                delete msgStack.timeout;
                return _this.saveChatMsgStack();
            });
        }).then(function () {
            return sendNextMsg();
        });
    };

    return sendNextMsg().catch(function (e) {
        var timeout = 5 * 60;
        if (/PEER_ID_INVALID/.test(e)) {
            timeout = 6 * 60 * 60;
        }
        msgStack.timeout = base.getNow() + timeout;

        debug('sendNextMsg error!', e);
    });
};

MsgStack.prototype.saveChatMsgStack = function () {
    var chatMsgStack = this.config.chatMsgStack;

    return base.storage.set({
        chatMsgStack: chatMsgStack
    });
};

MsgStack.prototype.save = function () {
    var _this = this;
    return _this.saveChatMsgStack();
};

MsgStack.prototype.callStack = function () {
    var _this = this;
    var promiseChatIdMap = _this.promiseChatIdMap;
    var promiseList = [];
    var chatMsgStack = _this.config.chatMsgStack;
    Object.keys(chatMsgStack).forEach(function (chatId) {
        var promise = promiseChatIdMap[chatId] || Promise.resolve();

        promise = promiseChatIdMap[chatId] = promise.then(function () {
            return _this.callMsgList(chatId);
        }).finally(function () {
            if (promiseChatIdMap[chatId] === promise) {
                delete promiseChatIdMap[chatId];
            }
        });

        promiseList.push(promise);
    });
    return Promise.all(promiseList);
};

MsgStack.prototype.notify = function (stream) {
    var _this = this;
    _this.addInStack(stream);

    return _this.save().then(function () {
        return _this.callStack();
    }).then(function () {
        _this.clear();
        return _this.save();
    });
};

module.exports = MsgStack;