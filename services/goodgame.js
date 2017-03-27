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
    this.name = 'goodgame';
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
};

var videoIdToId = function (videoId) {
    return 'g' + videoId;
};

var noProtocolRe = /^\/\//;

GoodGame.prototype.normalizeResponse = function (item) {
    if (item.status !== 'Live') {
        return;
    }

    var id = videoIdToId(item.id);
    var viewers = parseInt(item.viewers) || 0;

    var thumb = item.channel.thumb;
    var previewList = [];
    if (thumb) {
        previewList.push(thumb.replace(/_240(\.jpg)$/, '$1'));
        previewList.push(thumb);
    }
    previewList = previewList.map(function(url) {
        if (noProtocolRe.test(url)) {
            url = 'http:' + url;
        }
        return base.noCacheUrl(url);
    });

    var games = item.channel.games;
    var game = '';
    games && games.some(function (item) {
        return game = item.title;
    });

    var channelId = item.key.toLowerCase();
    var channelName = item.key;
    var channelStatus = item.channel.title;
    var channelUrl = item.channel.url;

    return {
        id: id,
        viewers: viewers,
        preview: previewList,
        status: channelStatus,
        game: game,
        url: channelUrl,
        channelId: channelId,
        channelName: channelName
    };
};

/**
 * @param _channelIdsList
 * @return {Promise}
 */
GoodGame.prototype.getStreamList = function (_channelIdsList) {
    var _this = this;

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
                return _this.getStreamsByChannelIds(channelIds, _this.name);
            });

            queue = queue.then(function (offlineStreams) {
                var offlineStreamIdStream = {};
                offlineStreams.forEach(function (item) {
                    offlineStreamIdStream[item.id] = item;
                });

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
                    var items = [];
                    responseBody._embedded.streams.forEach(function (item) {
                        var result = null;
                        try {
                            result = _this.normalizeResponse(item);
                        } catch (err) {
                            debug('normalizeResponse', err);
                        }
                        if (result) {
                            items.push(result);
                        }
                    });
                    items.forEach(function (stream) {
                        var isUpdate = false;
                        var _stream = offlineStreamIdStream[stream.id];
                        var pos = offlineStreams.indexOf(_stream);
                        if (pos !== -1) {
                            isUpdate = true;
                            offlineStreams.splice(pos, 1);
                        }
                        if (!isUpdate) {
                            _this.gOptions.msgStack.insertStream(stream);
                        } else {
                            _this.gOptions.msgStack.updateStream(stream);
                        }
                    });
                    offlineStreams.forEach(function (stream) {
                        _this.gOptions.msgStack.offlineStream(stream);
                    });
                }, function (err) {
                    offlineStreams.forEach(function (stream) {
                        _this.gOptions.msgStack.timeoutStream(stream);
                    });
                    debug("getList error!", err);
                });
            });
        });

        return queue;
    });

    return promise;
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
        if (!(err instanceof CustomError)) {
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
                return {
                    id: id,
                    title: title
                };
            });
        });
    });
};

module.exports = GoodGame;