/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:twitch');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = require('request-promise');
var CustomError = require('../customError').CustomError;

var Twitch = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.twitchToken;

    this.onReady = _this.init();
};

Twitch.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `twChannels` ( \
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

Twitch.prototype.migrate = function () {
    var _this = this;
    var db = this.gOptions.db;

    return base.storage.get(['twitchChannelInfo']).then(function(storage) {
        var channelInfo = storage.twitchChannelInfo || {};

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
                    INSERT INTO twChannels SET ? ON DUPLICATE KEY UPDATE id = id \
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
Twitch.prototype.getChannelInfo = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM twChannels WHERE id = ? LIMIT 1 \
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

Twitch.prototype.getChannelTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return getChannelTitleFromInfo(info) || channelId;
    });
};

/**
 * @param {Object} info
 * @return {Promise}
 */
Twitch.prototype.setChannelInfo = function(info) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO twChannels SET ? ON DUPLICATE KEY UPDATE ? \
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

Twitch.prototype.clean = function(channelIdList) {
    // todo: fix me
    return Promise.resolve();
    /*
    var _this = this;
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

Twitch.prototype.apiNormalization = function(data) {
    var _this = this;
    var now = base.getNow();

    var invalidArray = [];
    var streamArray = [];
    data.streams.forEach(function (apiItem) {
        if (!apiItem.channel || typeof apiItem.channel.name !== 'string') {
            debug('Item without name! %j', apiItem);
            return;
        }

        var channelId = apiItem.channel.name.toLowerCase();

        if (
            !apiItem._id ||
            typeof apiItem.viewers !== 'number' ||
            typeof apiItem.channel.url !== 'string' ||
            typeof apiItem.created_at !== 'string' ||
            typeof apiItem.channel.status === 'undefined'
        ) {
            return invalidArray.push(channelId);
        }

        var previewList = [];

        apiItem.preview && ['template', 'large', 'medium'].forEach(function(quality) {
            var url = apiItem.preview[quality];
            if (!url) {
                return;
            }

            if (quality === 'template') {
                url = url.replace('{width}', '1280').replace('{height}', '720');
            }

            previewList.push(url);
        });

        previewList = previewList.map(base.noCacheUrl);

        var item = {
            _service: 'twitch',
            _checkTime: now,
            _insertTime: now,
            _id: 't' + apiItem._id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: apiItem.viewers,
            game: apiItem.game,
            preview: previewList,
            created_at: apiItem.created_at,
            channel: {
                display_name: apiItem.channel.display_name,
                name: apiItem.channel.name,
                status: apiItem.channel.status,
                url: apiItem.channel.url
            }
        };

        // _this.setChannelTitle(channelId, apiItem.channel.display_name);

        streamArray.push(item);
    });

    return {
        invalidArray: invalidArray,
        streamArray: streamArray
    };
};

Twitch.prototype.getStreamList = function(channelList) {
    var _this = this;
    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var retryLimit = 5;
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://api.twitch.tv/kraken/streams',
                qs: {
                    limit: 100,
                    channel: arr.join(',')
                },
                headers: {
                    'Accept': 'application/vnd.twitchtv.v3+json',
                    'Client-ID': _this.config.token
                },
                json: true,
                gzip: true,
                forever: true
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

        return getList().then(function (responseBody) {
            var obj = null;
            try {
                obj = _this.apiNormalization(responseBody);
            } catch (e) {
                debug('Unexpected response %j', responseBody, e);
                throw new CustomError('Unexpected response');
            }

            videoList.push.apply(videoList, obj.streamArray);

            if (obj.invalidArray.length) {
                debug('Invalid array %j', obj.invalidArray);
                arr = obj.invalidArray;
                throw new CustomError('Invalid array!');
            }
        }).catch(function (err) {
            arr.forEach(function (channelId) {
                videoList.push(base.getTimeoutStream('twitch', channelId));
            });
            debug("Request stream list error!", err);
        });
    });

    return Promise.all(promiseList).then(function () {
        return videoList;
    });
};

Twitch.prototype.requestChannelByName = function (channelName) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://api.twitch.tv/kraken/search/channels',
        qs: {
            q: channelName,
            limit: 1
        },
        headers: {
            'Accept': 'application/vnd.twitchtv.v3+json',
            'Client-ID': _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var firstChannel = null;
        try {
            if (responseBody.channels.length > 0) {
                firstChannel = responseBody.channels[0];
            }
        } catch (e) {
            debug('Unexpected response %j', responseBody, e);
            throw new CustomError('Unexpected response');
        }

        if (!firstChannel) {
            throw new CustomError('Channel is not found by name!');
        }

        var name = firstChannel.name;
        if (!name || typeof name !== 'string') {
            debug('Unexpected response %j', responseBody, e);
            throw new CustomError('Unexpected response');
        }

        return firstChannel;
    });
};

Twitch.prototype.requestChannelInfo = function (channelId) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://api.twitch.tv/kraken/channels/' + encodeURIComponent(channelId),
        headers: {
            'Accept': 'application/vnd.twitchtv.v3+json',
            'Client-ID': _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        if (!responseBody) {
            throw new CustomError('Channel is not found by id!');
        }

        var name = responseBody.name;
        if (!name || typeof name !== 'string') {
            debug('Unexpected response %j', responseBody, e);
            throw new CustomError('Unexpected response');
        }

        return responseBody;
    });
};

Twitch.prototype.getChannelId = function(channelId) {
    var _this = this;
    return this.requestChannelInfo(channelId).catch(function () {
        return _this.requestChannelByName(channelId);
    }).then(function (channelInfo) {
        var channelId = channelInfo.name.toLowerCase();

        return _this.setChannelInfo({
            id: channelId,
            title: channelInfo.display_name
        }).then(function () {
            return channelId
        });
    });
};

module.exports = Twitch;