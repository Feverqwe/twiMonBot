/**
 * Created by Anton on 23.02.2017.
 */
"use strict";
var debug = require('debug')('app:users');
var debugLog = require('debug')('app:users:log');
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
            UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
            UNIQUE INDEX `channelId_UNIQUE` (`id` ASC)); \
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
                `service` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
            INDEX `chatId_idx` (`chatId` ASC), \
            INDEX `service_idx` (`service` ASC), \
            INDEX `channelId_idx` (`channelId` ASC), \
            UNIQUE INDEX `chatIdServiceChannelId_UNIQUE` (`chatId` ASC, `service` ASC, `channelId` ASC), \
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
    return promise;
};

/**
 * @typedef {{}} Chat
 * @property {string} id
 * @property {string|null} [channelId]
 * @property {{}} [options]
 * @property {boolean} [options.mute]
 * @property {boolean} [options.hidePreview]
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
 * @return {Promise}
 */
Users.prototype.removeChat = function (id) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chats WHERE id = ?; \
        ', [id], function (err) {
            if (err) {
                reject(err);
            } else {
                debugLog('[remove] %s', id);
                resolve();
            }
        });
    });
};

/**
 * @param {string} chatId
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.removeChatChannel = function (chatId, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE chats SET channelId = ? WHERE id = ?; \
        ', [null, chatId], function (err) {
            if (err) {
                reject(err);
            } else {
                debugLog('[remove] %s %s', chatId, channelId);
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
            SELECT service, channelId FROM chatIdChannelId WHERE chatId = ? ORDER BY insertTime ASC; \
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
            SELECT service, channelId FROM chatIdChannelId WHERE chatId = ? AND channelId = ? LIMIT 1; \
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
 * @param {string} service
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.addChannel = function (chatId, service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var item = {
            chatId: chatId,
            service: service,
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
 * @param {string} service
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.removeChannel = function (chatId, service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chatIdChannelId WHERE chatId = ? AND service = ? AND channelId = ?; \
        ', [chatId, service, channelId], function (err) {
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
            SELECT * FROM chatIdChannelId; \
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
            SELECT DISTINCT service, channelId FROM chatIdChannelId; \
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
 * @param {string} service
 * @param {string} channelId
 * @return {Promise}
 */
Users.prototype.getChatIdsByChannel = function (service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT chatId FROM chatIdChannelId WHERE service = ? AND channelId = ?; \
        ', [service, channelId], function (err, results) {
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