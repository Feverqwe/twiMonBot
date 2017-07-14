/**
 * Created by anton on 19.07.15.
 */
"use strict";
const debug = require('debug')('app:goodgame');
const base = require('../base');
const requestPromise = require('request-promise');
const CustomError = require('../customError').CustomError;

var GoodGame = function (options) {
    this.gOptions = options;
    this.channels = options.channels;
    this.name = 'goodgame';
};

GoodGame.prototype.isServiceUrl = function (url) {
    return [
        /goodgame\.ru\//i
    ].some(function (re) {
        return re.test(url);
    });
};

GoodGame.prototype.getChannelUrl = function (channelIName) {
    return 'https://goodgame.ru/channel/' + channelIName;
};

var noProtocolRe = /^\/\//;

GoodGame.prototype.insertItem = function (channel, stream) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (stream.status !== 'Live') {
            return;
        }

        var id = stream.id;

        var previewList = [];
        var thumb = stream.channel.thumb;
        if (thumb) {
            previewList.push(thumb.replace(/_240(\.jpg)$/, '$1'));
        }
        previewList = previewList.map(function(url) {
            if (noProtocolRe.test(url)) {
                url = 'https:' + url;
            }
            return base.noCacheUrl(url);
        });

        var game = '';
        var games = stream.channel.games;
        games && games.some(function (item) {
            return game = item.title;
        });

        var data = {
            isRecord: false,
            viewers: parseInt(stream.viewers) || 0,
            game: game,
            preview: previewList,
            created_at: undefined,
            channel: {
                name: stream.key,
                status: stream.channel.title,
                url: stream.channel.url
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

/**
 * @param _channelList
 * @return {Promise}
 */
GoodGame.prototype.getStreamList = function (_channelList) {
    var _this = this;
    var videoList = [];

    var promise = Promise.resolve(_channelList);

    promise = promise.then(function (channels) {
        if (!channels.length) return;

        var queue = Promise.resolve();

        base.arrToParts(channels, 25).forEach(function (channelsPart) {
            var channelIdMap = {};
            channelsPart.forEach(function (channel) {
                var id = _this.channels.unWrapId(channel.id);
                channelIdMap[id] = channel;
            });

            queue = queue.then(function () {
                var retryLimit = 1;
                var getList = function () {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://api2.goodgame.ru/v2/streams',
                        qs: {
                            ids: Object.keys(channelIdMap).join(','),
                            adult: true,
                            hidden: true
                        },
                        headers: {
                            'Accept': 'application/vnd.goodgame.v2+json'
                        },
                        json: true,
                        gzip: true,
                        forever: retryLimit === 1
                    }).then(function (responseBody) {
                        if (!Array.isArray(responseBody && responseBody._embedded && responseBody._embedded.streams)) {
                            var err = new Error('Unexpected response');
                            err.channelIdMap = channelIdMap;
                            err.responseBody = responseBody;
                            throw err;
                        }

                        return responseBody;
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
                    var items = responseBody._embedded.streams;
                    return insertPool.do(function () {
                        var stream = items.shift();
                        if (!stream) return;

                        return Promise.resolve().then(function () {
                            var channel = channelIdMap[stream.key.toLowerCase()];
                            if (!channel) {
                                var err = new Error('Channel is not found!');
                                err.stream = stream;
                                throw err;
                            }

                            return _this.insertItem(channel, stream).then(function (item) {
                                item && videoList.push(item);
                            }).catch(function (err) {
                                videoList.push(base.getTimeoutStream(channel));
                                throw err;
                            });
                        }).catch(function (err) {
                            debug("insertItem error!", err);
                        });
                    });
                }).catch(function (err) {
                    channelsPart.forEach(function (channel) {
                        videoList.push(base.getTimeoutStream(channel));
                    });
                    debug("Request stream list error! %o", err);
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
        /goodgame\.ru\/channel\/([\w\-]+)/i
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
            var url = _this.getChannelUrl(id);

            return _this.channels.insertChannel(id, _this.name, title, url);
        });
    });
};

module.exports = GoodGame;