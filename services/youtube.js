/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:youtube');
const base = require('../base');
const CustomError = require('../customError').CustomError;

var apiQuote = new base.Quote(1000);
const requestPromise = apiQuote.wrapper(require('request-promise'));

var Youtube = function(options) {
    this.super(options);
    this.name = 'youtube';
    this.config = {
        token: options.config.ytToken
    };
};

Youtube.prototype = Object.create(require('./service').prototype);
Youtube.prototype.constructor = Youtube;

Youtube.prototype.isServiceUrl = function (url) {
    return [
        /youtu\.be\//i,
        /youtube\.com\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Youtube.prototype.getChannelUrl = function (channelName) {
    return 'https://youtube.com/channel/' + channelName;
};

Youtube.prototype.insertItem = function (channel, snippet, id, viewers) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (snippet.liveBroadcastContent !== 'live') {
            return;
        }

        var previewList = ['maxresdefault_live', 'sddefault_live', 'hqdefault_live', 'mqdefault_live', 'default_live'].map(function(quality) {
            return 'https://i.ytimg.com/vi/' + id + '/' + quality + '.jpg';
        });

        /*var previewList = Object.keys(snippet.thumbnails).map(function(quality) {
            return snippet.thumbnails[quality];
        }).sort(function(a, b) {
            return a.width > b.width ? -1 : 1;
        }).map(function(item) {
            return item.url;
        });*/

        var game = '';

        var data = {
            viewers: viewers,
            game: game,
            preview: previewList,
            created_at: snippet.publishedAt,
            channel: {
                name: snippet.channelTitle || snippet.channelId,
                status: snippet.title,
                url: 'https://gaming.youtube.com/watch?v=' + id
            }
        };

        var item = {
            id: _this.channels.wrapId(id, _this.name),
            channelId: channel.id,
            data: JSON.stringify(data),
            checkTime: base.getNow(),
            isOffline: 0,
            isTimeout: 0
        };

        var promise = Promise.resolve();
        if (channel.title !== data.channel.name) {
            promise = promise.then(function () {
                channel.title = data.channel.name;
                return _this.channels.updateChannel(channel.id, channel);
            });
        }

        return promise.then(function () {
            return item;
        });
    });
};

var insertPool = new base.Pool(15);

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
        debug('getViewers %s error! %o', id, err);
        return -1;
    });
};

var requestPool = new base.Pool(10);

Youtube.prototype.getStreamList = function(_channelList) {
    var _this = this;

    var getPage = function (/*dbChannel*/channel) {
        var retryLimit = 1;
        var requestPage = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://www.googleapis.com/youtube/v3/search',
                qs: {
                    part: 'snippet',
                    channelId: _this.channels.unWrapId(channel.id),
                    eventType: 'live',
                    maxResults: 5,
                    order: 'date',
                    safeSearch: 'none',
                    type: 'video',
                    fields: 'items(id/videoId,snippet)',
                    key: _this.config.token
                },
                json: true,
                gzip: true,
                forever: true
            }).then(function (responseBody) {
                if (!Array.isArray(responseBody.items)) {
                    var err = new Error('Unexpected response');
                    err.channelId = _this.channels.unWrapId(channel.id);
                    err.responseBody = responseBody;
                    throw err;
                }

                return responseBody;
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
            var items = responseBody.items;
            return insertPool.do(function () {
                var item = items.shift();
                if (!item) return;

                var snippet = item.snippet;
                var videoId = item.id.videoId;

                return _this.getViewers(videoId).then(function(viewers) {
                    return _this.insertItem(channel, snippet, videoId, viewers).then(function (item) {
                        item && streamList.push(item);
                    }).catch(function (err) {
                        streamList.push(base.getTimeoutStream(channel));
                        debug("insertItem error!", err);
                    });
                });
            });
        }).catch(function(err) {
            streamList.push(base.getTimeoutStream(channel));
            debug('Stream list item %s response error!', channel.id, err);
        });
    };

    var promise = Promise.resolve(_channelList);

    promise = promise.then(function (channels) {
        return requestPool.do(function () {
            var channel = channels.shift();
            if (!channel) return;

            return getPage(channel);
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
        /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
        /youtube\.com\/([\w\-]+)/i
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

    if (!/^[\w\-]+$/.test(username)) {
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
    var channelId = '';
    [
        /youtube\.com\/(?:#\/)?(?:c|channel)\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            channelId = m[1];
            return true;
        }
    });

    if (!channelId) {
        channelId = url;
    }

    if (!/^UC/.test(channelId)) {
        return Promise.reject(new CustomError('It is not channel url!'));
    }

    return Promise.resolve(channelId);
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

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!(err instanceof CustomError)) {
            throw err;
        }

        return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
            if (!(err instanceof CustomError)) {
                throw err;
            }

            return _this.requestChannelIdByUsername(channelName).catch(function (err) {
                if (!(err instanceof CustomError)) {
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

            var id = channelId;
            var title = snippet.channelTitle || channelId;
            var url = _this.getChannelUrl(channelId);

            return _this.channels.insertChannel(id, _this.name, title, url);
        });
    });
};

module.exports = Youtube;