const base = require('./base');
const debug = require('debug')('app:messages');

class BotMessages {
    constructor(options) {
        const self = this;
        this.gOptions = options;

        options.events.on('checkBotMessages', function () {
            self.checkBotMessages();
        });

        self.onReady = this.init();

        this.activeChatIds = [];
        this.activePromises = [];
    }
    /**
     * @return {Promise}
     */
    init() {
        const db = this.gOptions.db;
        let promise = Promise.resolve();
        promise = promise.then(function () {
            return new Promise(function (resolve, reject) {
                db.connection.query('\
                    CREATE TABLE IF NOT EXISTS `botMessages` ( \
                        `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                        `streamId` VARCHAR(191) CHARACTER SET utf8mb4, \
                        `msgId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                        `msgChatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                        `type` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                        `data` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                        `insertTime` INT NOT NULL, \
                        `timeout` INT NULL DEFAULT 0, \
                    UNIQUE INDEX `msgIdMsgChatIdType` (`msgId` ASC, `msgChatId` ASC, `type` ASC), \
                    INDEX `streamId_idx` (`streamId` ASC), \
                    INDEX `msgId_idx` (`msgId` ASC), \
                    INDEX `msgChatId_idx` (`msgChatId` ASC), \
                    INDEX `type_idx` (`type` ASC), \
                    INDEX `timeout_idx` (`timeout` ASC), \
                    FOREIGN KEY (`streamId`) \
                        REFERENCES `streams` (`id`) \
                        ON DELETE SET NULL \
                        ON UPDATE CASCADE, \
                    FOREIGN KEY (`chatId`) \
                        REFERENCES `chats` (`id`) \
                        ON DELETE CASCADE \
                        ON UPDATE CASCADE); \
                ', function (err) {
                    err ? reject(err) : resolve();
                });
            });
        });
        return promise;
    }
    /**
     * @typedef {{}} BotMessage
     * @property {string} chatId
     * @property {string|null} streamId
     * @property {string} msgId
     * @property {string} msgChatId
     * @property {string} type
     * @property {Object} data
     * @property {number} insertTime
     * @property {number} timeout
     */
    /**
     * @param dbMessage
     * @return {BotMessage}
     */
    deSerializeMessageRow(dbMessage) {
        if (dbMessage) {
            dbMessage.data = JSON.parse(dbMessage.data);
        }
        return dbMessage || null;
    }
    /**
     * @typedef {{}} BotMessageItem
     * @property {BotMessage} botMessages
     * @property {Chat} chats
     */
    /**
     * @return {Promise.<BotMessageItem[]>}
     */
    getItems() {
        const self = this;
        const db = this.gOptions.db;
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                SELECT \
                ' + db.wrapTableParams('botMessages', ['chatId', 'streamId', 'msgId', 'msgChatId', 'type', 'data', 'insertTime', 'timeout']) + ', \
                ' + db.wrapTableParams('chats', ['id', 'channelId', 'options', 'insertTime']) + ' \
                FROM botMessages \
                INNER JOIN chats ON botMessages.chatId = chats.id \
                WHERE botMessages.timeout < ? \
                LIMIT 30; \
            ', [base.getNow()], function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results.map(function (row) {
                        const item = db.unWrapTableParams(row);
                        item.botMessages = self.deSerializeMessageRow(item.botMessages);
                        item.chats = self.gOptions.users.deSerializeChatRow(item.chats);
                        return item;
                    }));
                }
            });
        });
    }

    /**
     * @param {string} chatId
     * @param {string} streamId
     * @param {string} msgChatId
     * @param {string} msgId
     * @return {Promise}
     */
    insertDeleteMessage(chatId, streamId, msgChatId, msgId) {
        const db = this.gOptions.db;
        const data = {
            chatId,
            streamId,
            msgId,
            msgChatId,
            type: 'delete',
            data: JSON.stringify({}),
            insertTime: base.getNow(),
            timeout: base.getNow() + 24 * 60 * 60
        };
        return new Promise(function (resolve, reject) {
            db.connection.query(' \
                INSERT INTO botMessages SET ?; \
            ', [data], function (err, result) {
                err ? reject(err) : resolve(result);
            });
        }).catch(function (err) {
            debug('insertDeleteMessage error %o', err);
        });
    }
    /**
     * @param {BotMessage} botMessage
     * @return {Promise}
     */
    removeItem(botMessage) {
        const self = this;
        const db = self.gOptions.db;
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                DELETE FROM botMessages WHERE msgId = ? AND msgChatId = ? AND type = ?; \
            ', [botMessage.msgId, botMessage.msgChatId, botMessage.type], function (err, result) {
                err ? reject(err) : resolve(result);
            });
        });
    }
    /**
     * @param {BotMessage} botMessage
     * @param {number} timeout
     * @return {Promise}
     */
    setTimeout(botMessage, timeout) {
        const self = this;
        const db = self.gOptions.db;
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                UPDATE botMessages SET timeout = ? WHERE msgId = ? AND msgChatId = ? AND type = ?; \
            ', [timeout, botMessage.msgId, botMessage.msgChatId, botMessage.type], function (err, result) {
                err ? reject(err) : resolve(result);
            });
        });
    }
    /**
     * @param {BotMessage} botMessage
     * @return {Promise}
     */
    deleteMessageTask(botMessage) {
        const self = this;
        return Promise.resolve().then(function () {
            if (botMessage.streamId !== null) {
                const diffSeconds = base.getNow() - botMessage.insertTime;
                if (diffSeconds > 48 * 60 * 60) {
                    // debug('removeItem mor 48h', botMessage.chatId, botMessage.msgId);
                    return self.removeItem(botMessage);
                } else {
                    // debug('setTimeout', botMessage.chatId, botMessage.msgId);
                    return self.setTimeout(botMessage, base.getNow() + 60 * 60);
                }
            } else {
                return self.setTimeout(botMessage, base.getNow() + 5 * 60).then(function () {
                    return self.gOptions.bot.deleteMessage(botMessage.msgChatId, botMessage.msgId).catch(function (err) {
                        if (err.code === 'ETELEGRAM') {
                            const body = err.response.body;
                            if (
                                body.error_code !== 403 &&
                                !/message to delete not found/.test(body.description) &&
                                !/chat not found/.test(body.description) &&
                                !/group chat was upgraded/.test(body.description)
                            ) {
                                throw err;
                            }
                        } else {
                            throw err;
                        }
                    }).then(function () {
                        return self.removeItem(botMessage);
                    });
                });
            }
        }).catch(function (err) {
            debug('deleteMessage error %o', err);
        });
    }
    /**
     * @param {BotMessageItem} item
     * @return {Promise}
     */
    runAction(item) {
        const self = this;
        switch (item.botMessages.type) {
            case 'delete': {
                return self.deleteMessageTask(item.botMessages);
            }
            default: {
                throw new Error('Unknown action type');
            }
        }
    }
    checkBotMessages() {
        const self = this;
        const limit = 10;

        const activePromises = self.activePromises;
        const activeChatIds = self.activeChatIds;

        if (activePromises.length >= limit) return;

        self.getItems().then(function (items) {
            items.some(function (item) {
                const chatId = item.chats.id;

                if (activePromises.length >= limit) return true;
                if (activeChatIds.indexOf(chatId) !== -1) return;

                const promise = self.runAction(item);
                activeChatIds.push(chatId);
                activePromises.push(promise);

                const any = function () {
                    base.removeItemFromArray(activeChatIds, chatId);
                    base.removeItemFromArray(activePromises, promise);
                    self.checkBotMessages();
                };

                promise.then(function (result) {
                    any();
                    return result;
                }, function (err) {
                    any();
                    throw err;
                });
            });
        });
    }
}

module.exports = BotMessages;