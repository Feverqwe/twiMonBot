/**
 * Created by Anton on 21.05.2016.
 */
var base = require('./base');
var debug = require('debug')('MsgStack');
var Promise = require('bluebird');

var MsgStack = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.saveThrottle = base.throttle(this.save, 100, this);

    this.inProgressChatId = [];

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
        var msgStack = base.getObjectItemOrArray(chatMsgStack, chatId);
        base.removeItemFromArray(msgStack, msgId);
        msgStack.push(msgId);
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

    var msgList = chatMsgStack[chatId];
    if (!msgList) {
        return Promise.resovle();
    }

    var sendNextMsg = function () {
        if (!msgList.length) {
            delete chatMsgStack[chatId];
            return;
        }

        return Promise.try(function () {
            var msgId = msgList[0];
            var chatList = [];
            var videoItem = _this.stack.getItem(msgId);
            if (!videoItem) {
                debug('VideoItem is not found! %s', msgId);
                base.removeItemFromArray(msgList, msgId);
                return _this.saveThrottle();
            }

            var chatItem = _this.gOptions.storage.chatList[chatId];
            if (!chatItem) {
                debug('chatItem is not found! %s', msgId);
                throw 'chatItem is not found!';
            }

            var options = chatItem.options || {};

            var text = null;
            if (!options.hidePreview) {
                text = base.getNowStreamPhotoText(_this.gOptions, videoItem);
            }
            var noPhotoText = base.getNowStreamText(_this.gOptions, videoItem);

            if (options.channel) {
                !options.mute && chatList.push(chatId);
                chatList.push(options.channel);
            } else {
                chatList.push(chatId);
            }

            return _this.gOptions.checker.sendNotify(chatList, text, noPhotoText, videoItem, true).then(function () {
                base.removeItemFromArray(msgList, msgId);
                return _this.saveThrottle();
            });
        }).then(function () {
            return sendNextMsg();
        }).catch(function (e) {
            debug('sendNextMsg error! %s', e);
        });
    };

    return sendNextMsg();
};

MsgStack.prototype.save = function () {
    var _this = this;
    var chatMsgStack = this.config.chatMsgStack;

    return base.storage.set({
        chatMsgStack: chatMsgStack
    });
};

MsgStack.prototype.callStack = function () {
    var _this = this;
    var inProgressChatId = this.inProgressChatId;
    var promiseList = [];
    var chatMsgStack = this.config.chatMsgStack;
    Object.keys(chatMsgStack).map(function (chatId) {
        if (inProgressChatId.indexOf(chatId) !== -1) {
            return;
        }
        inProgressChatId.push(chatId);

        var promise = _this.callMsgList(chatId).then(function () {
            base.removeItemFromArray(inProgressChatId, chatId);
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