/**
 * Created by anton on 19.07.15.
 */
"use strict";
var debug = require('debug')('app:goodgame');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = require('request-promise');
var CustomError = require('../customError').CustomError;

var GoodGame = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.dbTable = 'ggChannels';

    this.onReady = _this.init();
};

GoodGame.prototype = Object.create(require('./service').prototype);
GoodGame.prototype.constructor = GoodGame;

GoodGame.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS ' + _this.dbTable + ' ( \
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
    return promise;
};

GoodGame.prototype.isServiceUrl = function (url) {
    return [
        /goodgame\.ru\//i
    ].some(function (re) {
        return re.test(url);
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
 * @param _channelIdsList
 * @return {Promise}
 */
GoodGame.prototype.getStreamList = function (_channelIdsList) {
    var _this = this;
    var videoList = [];

    var promise = Promise.resolve();

    promise = promise.then(function () {
        return _this.getChannelsInfo(_channelIdsList).then(function (channels) {
            if (_channelIdsList.length !== channels.length) {
                var foundIds = channels.map(function (channel) {
                    return channel.id;
                });
                var notFoundIds = _channelIdsList.filter(function (id) {
                    return foundIds.indexOf(id) === -1;
                });
                debug('Not found channels %j', notFoundIds);
            }
            return channels;
        });
    });

    promise = promise.then(function (channels) {
        if (!channels.length) return;

        var queue = Promise.resolve();

        base.arrToParts(channels, 25).forEach(function (channelsPart) {
            var channelIds = channelsPart.map(function (channel) {
                return channel.id;
            });

            queue = queue.then(function () {
                var retryLimit = 5;
                var getList = function () {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://api2.goodgame.ru/v2/streams',
                        qs: {
                            ids: channelIds.join(','),
                            adult: true,
                            hidden: true
                        },
                        headers: {
                            'Accept': 'application/vnd.goodgame.v2+json'
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
                    try {
                        var list = _this.apiNormalization(responseBody);
                        videoList.push.apply(videoList, list);
                    } catch (e) {
                        debug('Unexpected response %j', responseBody, e);
                        throw new CustomError('Unexpected response');
                    }
                }).catch(function (err) {
                    channelIds.forEach(function (channelId) {
                        videoList.push(base.getTimeoutStream('goodgame', channelId));
                    });
                    debug("Request stream list error!", err);
                });
            });
        });

        return queue;
    });

    return promise.then(function () {
        return videoList;
    });
};

GoodGame.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /goodgame\.ru\/channel\/([^\/]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            channelId = m[1];
            return true;
        }
    });
    if (!channelId) {
        return Promise.reject(new CustomError("Is not channel url!"));
    } else {
        return Promise.resolve(channelId);
    }
};

/**
 * @param channelName
 * @return {Promise}
 */
GoodGame.prototype.getChannelId = function (channelName) {
    var _this = this;

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        return channelName;
    }).then(function (channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelId),
            headers: {
                'Accept': 'application/vnd.goodgame.v2+json'
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function (responseBody) {
            var title = responseBody.key;
            if (!title) {
                throw new CustomError('Channel is not found!');
            }

            var id = title.toLowerCase();
            return _this.setChannelInfo({
                id: id,
                title: title
            }).then(function () {
                return id;
            });
        });
    });
};

module.exports = GoodGame;