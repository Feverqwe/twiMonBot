/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:msgStack');
var debugLog = require('debug')('app:msgStack:log');
debugLog.log = console.log.bind(console);
var Promise = require('bluebird');

var MsgStack = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.promiseChatIdMap = {};

    options.events.on('notify', function (stream) {
        return _this.notify(stream);
    });

    this.onReady = _this.init();
};

MsgStack.prototype.init = function () {
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `streams` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `service` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `data` LONGTEXT CHARACTER SET utf8mb4 NOT NULL, \
                `imageFileId` TEXT CHARACTER SET utf8mb4 NULL, \
                `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
                `checkTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
                `isOffline` INT NOT NULL DEFAULT 0, \
                `isTimeout` INT NOT NULL DEFAULT 0, \
            UNIQUE INDEX `videoIdChannelIdService_UNIQUE` (`id` ASC, `channelId` ASC, `service` ASC), \
            INDEX `channelId_idx` (`channelId` ASC), \
            INDEX `service_idx` (`service` ASC),  \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC)); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `liveMessages` ( \
                    `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `streamId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `type` VARCHAR(191) CHARACTER SET utf8mb4 NULL, \
                UNIQUE INDEX `chatIdStreamId_UNIQUE` (`id` ASC, `chatId` ASC), \
                INDEX `id_idx` (`id` ASC),  \
                INDEX `chatId_idx` (`chatId` ASC),  \
                INDEX `streamId_idx` (`streamId` ASC),  \
                FOREIGN KEY (`streamId`) \
                    REFERENCES `streams` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
                FOREIGN KEY (`chatId`) \
                    REFERENCES `chats` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE); \
            ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `chatIdStreamId` ( \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `streamId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `messageId` VARCHAR(191) CHARACTER SET utf8mb4 NULL, \
                    `messageType` VARCHAR(191) CHARACTER SET utf8mb4 NULL, \
                    `timeout` INT NULL DEFAULT 0, \
                UNIQUE INDEX `chatIdStreamId_UNIQUE` (`chatId` ASC, `streamId` ASC), \
                FOREIGN KEY (`streamId`) \
                    REFERENCES `streams` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
                FOREIGN KEY (`chatId`) \
                    REFERENCES `chats` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
                FOREIGN KEY (`messageId`) \
                    REFERENCES `liveMessages` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE); \
            ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    return promise;
};

MsgStack.prototype.getStreamsByChannelIds = function (channelIds, service) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        if (!channelIds.length) {
            return resolve([]);
        }
        db.connection.query('\
            SELECT * FROM streams WHERE service = ? AND channelId IN ?; \
        ', [service, [channelIds]], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

MsgStack.prototype.getLiveMessages = function (streamId, service) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM liveMessages WHERE service = ? AND streamId = ?; \
        ', [service, streamId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

MsgStack.prototype.addChatIdStreamId = function (connection, messages, streamId) {
    return new Promise(function (resolve, reject) {
        if (!messages.length) {
            return resolve();
        }
        var values = messages.map(function (message) {
            if (typeof message === 'object') {
                return [message.chatId, message.id, message.type, streamId];
            } else {
                return [message, null, null, streamId];
            }
        });
        connection.query('\
            INSERT INTO chatIdMessageId (chatId, messageId, messageType, streamId) VALUES ? ON DUPLICATE KEY UPDATE chatId = chatId; \
        ', [values], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.insertStream = function (connection, stream) {
    return new Promise(function (resolve, reject) {
        connection.query('\
            INSERT INTO streams SET ? ON DUPLICATE KEY UPDATE ?; \
        ', [stream, stream], function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

MsgStack.prototype.addInStack = function (videoItem) {
    var chatMsgStack = this.config.chatMsgStack;

    var msgId = videoItem._id;

    this.gOptions.users.getChatIdsByChannel(videoItem._service, videoItem._channelId).then(function (chatIds) {
        chatIds.forEach(function (chatId) {
            var msgStack = base.getObjectItem(chatMsgStack, chatId, {});
            var msgList = base.getObjectItem(msgStack, 'stack', []);
            base.removeItemFromArray(msgList, msgId);
            msgList.push(msgId);
        });
    });
};

MsgStack.prototype.clear = function () {
    var _this = this;
    var chatMsgStack = this.config.chatMsgStack;

    this.gOptions.users.getAllChatIds().then(function (chatIds) {
        Object.keys(chatMsgStack).forEach(function (chatId) {
            if (chatIds.indexOf('' + chatId) === -1) {
                delete chatMsgStack[chatId];
            }
        });
    });
};

MsgStack.prototype.onSendMessageError = function (err) {
    var _this = this;
    /**
     * @type {Object}
     * @property {string} type
     * @property {string} id
     * @property {string} chatId
     */
    var itemObj = err.itemObj;
    var result = null;
    if (err.code === 'ETELEGRAM') {
        var body = err.response.body;

        var isBlocked = body.error_code === 403;
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

        if (isBlocked) {
            if (itemObj.type === 'chat') {
                result = _this.gOptions.users.removeChat(itemObj.chatId);
            } else {
                result = _this.gOptions.users.removeChatChannel(itemObj.chatId, itemObj.id);
            }
        } else
        if (itemObj.type === 'chat' && body.parameters && body.parameters.migrate_to_chat_id) {
            result = _this.gOptions.users.changeChatId(itemObj.chatId, body.parameters.migrate_to_chat_id);
        }
    }

    if (!result) {
        throw err;
    }

    return result;
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
            var data = _this.stack.getItem(msgId);
            if (!data) {
                debug('VideoItem is not found! %s %s', msgId, chatId);
                base.removeItemFromArray(msgList, msgId);
                return;
            }

            var imageFileId = data._photoId;
            var messageId = data._id;

            return _this.gOptions.users.getChat(chatId).then(function (chat) {
                if (!chat) {
                    debug('chatItem is not found! %s %s', chatId, msgId);
                    throw new Error('chatItem is not found!');
                }

                var options = chat.options;

                var text = base.getNowStreamText(_this.gOptions, data);
                var caption = '';
                if (!options.hidePreview) {
                    caption = base.getNowStreamPhotoText(_this.gOptions, data);
                }

                var chatList = [{
                    type: 'chat',
                    id: chat.id,
                    chatId: chat.id
                }];
                if (chat.channelId) {
                    chatList.push({
                        type: 'channel',
                        id: chat.channelId,
                        chatId: chat.id
                    });
                    if (options.mute) {
                        chatList.shift();
                    }
                }

                var message = {
                    imageFileId: imageFileId,
                    caption: caption,
                    text: text
                };

                var promise = Promise.resolve();
                chatList.forEach(function (itemObj) {
                    var id = itemObj.id;
                    promise = promise.then(function () {
                        return _this.gOptions.msgSender.sendMessage(id, messageId, message, data, true).then(function () {
                            debugLog('[send] %s %s', chatId, data._id);
                        });
                    }).catch(function (err) {
                        err.itemObj = itemObj;
                        throw err;
                    });
                });
                return promise.catch(function (err) {
                    return _this.onSendMessageError(err);
                }).then(function () {
                    base.removeItemFromArray(msgList, msgId);
                    delete msgStack.timeout;
                    return _this.saveChatMsgStack();
                });
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