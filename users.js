/**
 * Created by Anton on 23.02.2017.
 */
"use strict";
const debug = require('debug')('app:users');
const debugLog = require('debug')('app:users:log');
debugLog.log = console.log.bind(console);

var Users = function (options) {
    this.gOptions = options;

    this.onReady = this.init();
};

Users.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `chats` ( \
                    `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NULL, \
                    `options` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                    `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
                UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
                UNIQUE INDEX `channelId_UNIQUE` (`channelId` ASC)); \
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
                CREATE TABLE IF NOT EXISTS `chatIdChannelId` ( \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
                INDEX `chatId_idx` (`chatId` ASC), \
                UNIQUE INDEX `chatIdChannelId_UNIQUE` (`chatId` ASC, `channelId` ASC), \
                FOREIGN KEY (`chatId`) \
                        REFERENCES `chats` (`id`) \
                        ON DELETE CASCADE \
                        ON UPDATE CASCADE, \
                FOREIGN KEY (`channelId`) \
                    REFERENCES `channels` (`id`) \
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

/**
 * @typedef {{}} Chat
 * @property {string} id
 * @property {string|null} [channelId]
 * @property {{}} [options]
 * @property {boolean} [options.mute]
 * @property {boolean} [options.hidePreview]
 * @property {boolean} [options.unMuteRecords]
 */

/**
 * @param {{}} dbChat
 * @return {Chat|null}
 */
var dbChatToChat = function (dbChat) {
    if (dbChat) {
        if (!dbChat.options) {
            dbChat.options = {};
        } else {
            dbChat.options = JSON.parse(dbChat.options);
        }
    }
    return dbChat || null;
};

/**
 * @param {string} id
 * @return {Promise.<Chat|null>}
 */
Users.prototype.getChat = function (id) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM chats WHERE id = ? LIMIT 1; \
        ', [id], function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(dbChatToChat(results[0]));
        });
    });
};

/**
 * @param {Chat} chat
 * @return {Promise}
 */
Users.prototype.setChat = function (chat) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var item = {
            id: chat.id,
            channelId: chat.channelId,
            options: JSON.stringify(chat.options || {})
        };
        db.connection.query('\
            INSERT INTO chats SET ? ON DUPLICATE KEY UPDATE ?; \
        ', [item, item], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
};

Users.prototype.getChatByChannelId = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM chats WHERE channelId = ? LIMIT 1; \
        ', [channelId], function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(dbChatToChat(results[0]));
        });
    });
};

/**
 * @param {string} id
 * @param {string} newId
 * @return {Promise}
 */
Users.prototype.changeChatId = function (id, newId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE chats SET id = ? WHERE id = ?; \
        ', [newId, id], function (err) {
            if (err) {
                reject(err);
            } else {
                debugLog('[migrate] %s > %s', id, newId);
                resolve();
            }
        });
    });
};

/**
 * @param {string} id
 * @param {string} reason
 * @return {Promise}
 */
Users.prototype.removeChat = function (id, reason) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chats WHERE id = ?; \
        ', [id], function (err) {
            if (err) {
                reject(err);
            } else {
                debugLog('[remove] %s %j', id, reason);
                resolve();
            }
        });
    });
};

/**
 * @param {string} chatId
 * @param {string} channelId
 * @param {string} reason
 * @return {Promise}
 */
Users.prototype.removeChatChannel = function (chatId, channelId, reason) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE chats SET channelId = ? WHERE id = ?; \
        ', [null, chatId], function (err) {
            if (err) {
                reject(err);
            } else {
                debugLog('[remove] %s %s %j', chatId, channelId, reason);
                resolve();
            }
        });
    });
};

/**
 * @param {string} chatId
 * @return {Promise.<[{service: string, channelId: string}]>}
 */
Users.prototype.getChannels = function (chatId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id \
            WHERE chatId = ? ORDER BY insertTime ASC; \
        ', [chatId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

/**
 * @param {string} chatId
 * @param {string} channelId
 * @return {Promise.<[{service: string, channelId: string}]>}
 */
Users.prototype.getChannel = function (chatId, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id \
            WHERE chatId = ? AND channelId = ? LIMIT 1; \
        ', [chatId, channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
};

/**
 * @param {string} chatId
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.addChannel = function (chatId, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var item = {
            chatId: chatId,
            channelId: channelId
        };
        db.connection.query('\
            INSERT INTO chatIdChannelId SET ? ON DUPLICATE KEY UPDATE ?; \
        ', [item, item], function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

/**
 * @param {string} chatId
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.removeChannel = function (chatId, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chatIdChannelId WHERE chatId = ? AND channelId = ?; \
        ', [chatId, channelId], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

/**
 * @return {Promise}
 */
Users.prototype.getAllChatChannels = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT chatId, channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id; \
        ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

/**
 * @return {Promise}
 */
Users.prototype.getAllChannels = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT DISTINCT channels.* \
            FROM channels \
            INNER JOIN chatIdChannelId ON chatIdChannelId.channelId = channels.id; \
        ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

/**
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.getChatIdsByChannel = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT chatId FROM chatIdChannelId WHERE channelId = ?; \
        ', [channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results.map(function (item) {
                    return item.chatId;
                }));
            }
        });
    });
};

/**
 * @return {Promise}
 */
Users.prototype.getAllChatIds = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT id FROM chats; \
        ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results.map(function (item) {
                    return item.id;
                }));
            }
        });
    });
};

module.exports = Users;