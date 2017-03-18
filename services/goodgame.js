/**
 * Created by anton on 19.07.15.
 */
"use strict";
var debug = require('debug')('app:goodgame');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var GoodGame = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = _this.init();
};

GoodGame.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `ggChannels` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `title` TEXT CHARACTER SET utf8mb4 NULL, \
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
        return _this.migrate();
    });
    return promise;
};

GoodGame.prototype.migrate = function () {
    var _this = this;
    var db = this.gOptions.db;

    return base.storage.get(['ggChannelInfo']).then(function(storage) {
        var channelInfo = storage.ggChannelInfo || {};

        var channels = Object.keys(channelInfo);
        var threadCount = 100;
        var partSize = Math.ceil(channels.length / threadCount);

        var migrateChannel = function (connection, channelId, data) {
            var info = {
                id: channelId,
                title: data.title
            };
            return new Promise(function (resolve, reject) {
                connection.query('\
                    INSERT INTO ggChannels SET ? ON DUPLICATE KEY UPDATE id = id \
                ', info, function (err, results) {
                    if (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                            resolve();
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve();
                    }
                });
            }).catch(function (err) {
                debug('Migrate', err);
            });
        };

        return Promise.all(base.arrToParts(channels, partSize).map(function (arr) {
            return base.arrayToChainPromise(arr, function (channelId) {
                return db.newConnection().then(function (connection) {
                    return migrateChannel(connection, channelId, channelInfo[channelId]).then(function () {
                        connection.end();
                    });
                });
            });
        }));
    });
};

/**
 * @typedef {{}} ChannelInfo
 * @property {String} id
 * @property {String} title
 */

/**
 * @private
 * @param {String} channelId
 * @return {Promise}
 */
GoodGame.prototype.getChannelInfo = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM ggChannels WHERE id = ? LIMIT 1 \
        ', [channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0] || {});
            }
        });
    }).catch(function (err) {
        debug('getChannelInfo', err);
        return {};
    });
};

/**
 * @param {ChannelInfo} info
 * @return {String}
 */
var getChannelTitleFromInfo = function (info) {
    return info.title || info.id;
};

GoodGame.prototype.getChannelTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return getChannelTitleFromInfo(info) || channelId;
    });
};

/**
 * @param {Object} info
 * @return {Promise}
 */
GoodGame.prototype.setChannelInfo = function(info) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO ggChannels SET ? ON DUPLICATE KEY UPDATE ? \
        ', [info, info], function (err, results) {
            if (err) {
                debug('setChannelInfo', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

GoodGame.prototype.clean = function(channelIdList) {
    // todo: fix me
    return Promise.resolve();
    /*var _this = this;
    var promiseList = [];

    var needSaveState = false;
    var channelInfo = _this.config.channelInfo;
    Object.keys(channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete channelInfo[channelId];
            needSaveState = true;
            // debug('Removed from channelInfo %s', channelId);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveChannelInfo());
    }

    return Promise.all(promiseList);*/
};

var noProtocolRe = /^\/\//;

GoodGame.prototype.apiNormalization = function (data) {
    var _this = this;

    var now = base.getNow();
    var streamArray = [];
    data._embedded.streams.forEach(function (origItem) {
        if (origItem.status !== 'Live') {
            return;
        }

        if (!origItem.key || !origItem.id || !origItem.channel) {
            debug('Skip item! %j', origItem);
            return;
        }

        var id = origItem.id;
        var viewers = parseInt(origItem.viewers) || 0;
        var name = origItem.key;
        var channelId = name.toLowerCase();
        var channel = origItem.channel;

        var previewList = [];
        if (channel.thumb) {
            previewList.push(channel.thumb.replace(/_240(\.jpg)$/, '$1'));
            previewList.push(channel.thumb);
        }
        previewList = previewList.map(function(url) {
            if (noProtocolRe.test(url)) {
                url = 'http:' + url;
            }
            return base.noCacheUrl(url);
        });

        var game = channel.games && channel.games[0];
        if (game) {
            game = game.title;
        }

        var item = {
            _service: 'goodgame',
            _checkTime: now,
            _insertTime: now,
            _id: 'g' + id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: viewers,
            game: game,
            preview: previewList,
            created_at: undefined,
            channel: {
                name: name,
                status: channel.title,
                url: channel.url
            }
        };

        // _this.setChannelTitle(channelId, name);

        streamArray.push(item);
    });
    return streamArray;
};

/**
 * @param channelList
 * @return {Promise}
 */
GoodGame.prototype.getStreamList = function (channelList) {
    var _this = this;
    var videoList = [];

    var promiseList = base.arrToParts(channelList, 25).map(function (arr) {
        var retryLimit = 5;
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://api2.goodgame.ru/v2/streams',
                qs: {
                    ids: arr.join(','),
                    adult: true,
                    hidden: true
                },
                headers: {
                    'Accept': 'application/vnd.goodgame.v2+json'
                },
                json: true,
                gzip: true,
                forever: true
            }).then(function(response) {
                if (response.statusCode === 500) {
                    throw new CustomError(response.statusCode);
                }

                if (response.statusCode !== 200) {
                    debug('Unexpected response %j', response);
                    throw new CustomError('Unexpected response');
                }

                return response;
            }).catch(function (err) {
                if (retryLimit-- < 1) {
                    throw err;
                }

                return new Promise(function(resolve) {
                    return setTimeout(resolve, 250);
                }).then(function() {
                    // debug("Retry %s getList", retryLimit, err);
                    return getList();
                });
            });
        };

        return getList().then(function (response) {
            var responseBody = response.body;
            try {
                var list = _this.apiNormalization(responseBody);
                videoList.push.apply(videoList, list);
            } catch (e) {
                debug('Unexpected response %j', response, e);
                throw new CustomError('Unexpected response');
            }
        }).catch(function (err) {
            arr.forEach(function (channelId) {
                videoList.push(base.getTimeoutStream('goodgame', channelId));
            });
            debug("Request stream list error!", err);
        });
    });

    return Promise.all(promiseList).then(function () {
        return videoList;
    });
};

/**
 * @param channelName
 * @return {Promise}
 */
GoodGame.prototype.getChannelId = function (channelName) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelName),
        headers: {
            'Accept': 'application/vnd.goodgame.v2+json'
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function (response) {
        if (response.statusCode === 404) {
            throw new CustomError(response.statusCode);
        }

        if (response.statusCode !== 200) {
            debug('Unexpected response %j', response);
            throw new CustomError(response.statusCode);
        }

        var responseJson = response.body;

        var channelId = responseJson.key;
        if (!channelId) {
            throw new CustomError('Channel is not found!');
        }

        channelId = channelId.toLowerCase();
        return _this.setChannelInfo({
            id: channelId,
            title: responseJson.key
        }).then(function () {
            return channelId;
        });
    });
};

module.exports = GoodGame;