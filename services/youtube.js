/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var CustomError = require('../customError').CustomError;

var apiQuote = new base.Quote(1000);
const requestPromise = apiQuote.wrapper(require('request-promise'));

var Youtube = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;
    this.dbTable = 'ytChannels';

    this.onReady = _this.init();
};

Youtube.prototype = Object.create(require('./service').prototype);
Youtube.prototype.constructor = Youtube;

Youtube.prototype.init = function () {
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

Youtube.prototype.isServiceUrl = function (url) {
    return [
        /youtu\.be\//i,
        /youtube\.com\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Youtube.prototype.clean = function(channelIdList) {
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
            // debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveChannelInfo());
    }

    return Promise.all(promiseList);*/
};

Youtube.prototype.apiNormalization = function(channelId, data, viewers) {
    var now = base.getNow();
    var streams = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        if (snippet.liveBroadcastContent !== 'live') {
            return;
        }

        var videoId = origItem.id && origItem.id.videoId;
        if (!videoId) {
            debug('VideoId is not exists! %j', origItem);
            return;
        }

        var previewList = ['maxresdefault_live', 'sddefault_live', 'hqdefault_live', 'mqdefault_live', 'default_live'].map(function(quality) {
            return 'https://i.ytimg.com/vi/' + videoId + '/' + quality + '.jpg';
        });

        var item = {
            _service: 'youtube',
            _checkTime: now,
            _insertTime: now,
            _id: 'y' + videoId,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: viewers || 0,
            game: '',
            preview: previewList,
            created_at: snippet.snippet,
            channel: {
                display_name: snippet.channelTitle,
                name: snippet.channelId,
                status: snippet.title,
                url: 'https://gaming.youtube.com/watch?v=' + videoId
            }
        };

        streams.push(item);
    });
    return streams;
};

var intRe = /^\d+$/;

Youtube.prototype.getViewers = function(id) {
    return requestPromise({
        url: 'https://gaming.youtube.com/live_stats',
        qs: {
            v: id,
            t: Date.now()
        },
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        if (!intRe.test(responseBody)) {
            throw new Error('NOT INT ' + JSON.stringify(responseBody));
        }

        return parseInt(responseBody);
    }).catch(function (err) {
        debug('getViewers %s error', id, err);
        return -1;
    });
};

var requestPool = new base.Pool(10);

Youtube.prototype.getStreamList = function(_channelIdList) {
    var _this = this;

    var getPage = function (channelId) {
        var retryLimit = 5;
        var requestPage = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://www.googleapis.com/youtube/v3/search',
                qs: {
                    part: 'snippet',
                    channelId: channelId,
                    eventType: 'live',
                    maxResults: 1,
                    order: 'date',
                    safeSearch: 'none',
                    type: 'video',
                    fields: 'items(id/videoId,snippet)',
                    key: _this.config.token
                },
                json: true,
                gzip: true,
                forever: true
            }).catch(function (err) {
                if (retryLimit-- < 1) {
                    throw err;
                }

                return new Promise(function (resolve) {
                    setTimeout(resolve, 250);
                }).then(function () {
                    // debug('Retry %s requestPage %s', retryLimit, channelId, err);
                    return requestPage();
                });
            });
        };

        return requestPage().then(function (responseBody) {
            var videoId = '';
            responseBody.items.some(function (item) {
                return videoId = item.id.videoId;
            });
            if (!videoId) {
                return;
            }

            return _this.getViewers(videoId).then(function(viewers) {
                var streams = _this.apiNormalization(channelId, responseBody, viewers);
                streamList.push.apply(streamList, streams);
            });
        }).catch(function(err) {
            streamList.push(base.getTimeoutStream('youtube', channelId));
            debug('Stream list item %s response error!', channelId, err);
        });
    };

    var promise = Promise.resolve();
    promise = promise.then(function () {
        return requestPool.do(function () {
            var channelId = _channelIdList.shift();
            if (!channelId) return;

            return getPage(channelId);
        });
    });

    var streamList = [];
    return promise.then(function() {
        return streamList;
    });
};

/**
 * @param {String} query
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByQuery = function(query) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: query,
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var channelId = '';
        responseBody.items.some(function (item) {
            return channelId = item.id.channelId;
        });
        if (!channelId) {
            throw new CustomError('Channel ID is not found by query!');
        }

        return channelId;
    });
};

/**
 * @param {String} url
 * @return {Promise.<String>}
 */
Youtube.prototype.requestChannelIdByUsername = function(url) {
    var _this = this;

    var username = '';
    [
        /youtube\.com\/(?:#\/)?user\/([0-9A-Za-z_-]+)/i,
        /youtube\.com\/([0-9A-Za-z_-]+)$/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            username = m[1];
            return true;
        }
    });

    if (!username) {
        username = url;
    }

    if (!/^[0-9A-Za-z_-]+$/.test(username)) {
        return Promise.reject(new CustomError('It is not username!'));
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/channels',
        qs: {
            part: 'snippet',
            forUsername: username,
            maxResults: 1,
            fields: 'items/id',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var id = '';
        responseBody.items.some(function (item) {
            return id = item.id;
        });
        if (!id) {
            throw new CustomError('Channel ID is not found by username!');
        }

        return id;
    });
};

/**
 * @param {String} url
 * @returns {Promise.<String>}
 */
Youtube.prototype.getChannelIdByUrl = function (url) {
    if (/^UC/.test(url)) {
        return Promise.resolve(url);
    }

    var channelId = '';
    [
        /youtube\.com\/(?:#\/)?channel\/([0-9A-Za-z_-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            channelId = m[1];
            return true;
        }
    });

    if (!channelId) {
        return Promise.reject(new CustomError('It is not channel url!'));
    } else {
        return Promise.resolve(channelId);
    }
};

/**
 * @param {String} url
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByVideoUrl = function (url) {
    var _this = this;

    var videoId = '';
    [
        /youtu\.be\/([\w\-]+)/i,
        /youtube\.com\/.+[?&]v=([\w\-]+)/i,
        /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            videoId = m[1];
            return true;
        }
    });

    if (!videoId) {
        return Promise.reject(new CustomError('It is not video url!'));
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/videos',
        qs: {
            part: 'snippet',
            id: videoId,
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var channelId = '';
        responseBody.items.some(function (item) {
            return channelId = item.snippet.channelId;
        });
        if (!channelId) {
            throw new CustomError('Channel ID is empty');
        }

        return channelId;
    });
};

Youtube.prototype.getChannelId = function(channelName) {
    var _this = this;

    var channel = {
        id: null,
        title: null
    };

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
            if (!err instanceof CustomError) {
                throw err;
            }

            return _this.requestChannelIdByUsername(channelName).catch(function (err) {
                if (!err instanceof CustomError) {
                    throw err;
                }

                return _this.requestChannelIdByQuery(channelName);
            });
        });
    }).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                channelId: channelId,
                maxResults: 1,
                fields: 'items/snippet',
                key: _this.config.token
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function(responseBody) {
            var snippet = null;
            responseBody.items.some(function (item) {
                return snippet = item.snippet;
            });
            if (!snippet) {
                throw new CustomError('Channel is not found');
            }

            channel.id = channelId;
            channel.title = snippet.channelTitle;

            return _this.setChannelInfo(channel).then(function () {
                return channel.id;
            });
        });
    });
};

module.exports = Youtube;