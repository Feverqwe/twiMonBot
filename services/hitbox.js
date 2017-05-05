/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:hitbox');
const base = require('../base');
const requestPromise = require('request-promise');
const CustomError = require('../customError').CustomError;

var Hitbox = function(options) {
    this.super(options);
    this.name = 'hitbox';
};

Hitbox.prototype = Object.create(require('./service').prototype);
Hitbox.prototype.constructor = Hitbox;

Hitbox.prototype.isServiceUrl = function (url) {
    return [
        /hitbox\.tv\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Hitbox.prototype.getChannelUrl = function (channelName) {
    return 'http://hitbox.tv/' + channelName;
};

Hitbox.prototype.insertItem = function (channel, stream) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (stream.media_is_live < 1) {
            return;
        }

        var id = stream.media_id;

        var previewList = [];
        if (stream.media_thumbnail_large) {
            previewList.push(stream.media_thumbnail_large);
        } else
        if (stream.media_thumbnail) {
            previewList.push(stream.media_thumbnail);
        }
        previewList = previewList.map(function(path) {
            var url = 'http://edge.sf.hitbox.tv' + path;
            return base.noCacheUrl(url);
        });

        var data = {
            viewers: parseInt(stream.media_views) || 0,
            game: stream.category_name || '',
            preview: previewList,
            created_at: stream.media_live_since,
            channel: {
                name: stream.media_display_name || stream.media_user_name || stream.channel.user_name,
                status: stream.media_status,
                url: stream.channel.channel_link
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

Hitbox.prototype.getStreamList = function(_channelList) {
    var _this = this;
    var videoList = [];

    var promise = Promise.resolve(_channelList);

    promise = promise.then(function (channels) {
        if (!channels.length) return;

        var queue = Promise.resolve();

        base.arrToParts(channels, 100).forEach(function (channelsPart) {
            var channelIdMap = {};
            channelsPart.forEach(function (channel) {
                var id = _this.channels.unWrapId(channel.id);
                channelIdMap[id] = channel;
            });

            queue = queue.then(function () {
                var query = Object.keys(channelIdMap).map(function (item) {
                    return encodeURIComponent(item);
                }).join(',');

                var retryLimit = 1;
                var getList = function () {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://api.hitbox.tv/media/live/' + query,
                        qs: {
                            showHidden: 'true'
                        },
                        json: true,
                        gzip: true,
                        forever: retryLimit === 1
                    }).then(function (responseBody) {
                        if (!Array.isArray(responseBody.livestream)) {
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

                        return new Promise(function (resolve) {
                            return setTimeout(resolve, 250);
                        }).then(function () {
                            // debug("Retry %s getList", retryLimit, err);
                            return getList();
                        });
                    });
                };

                return getList().then(function (responseBody) {
                    var items = responseBody.livestream;
                    return insertPool.do(function () {
                        var stream = items.shift();
                        if (!stream) return;

                        return Promise.resolve().then(function () {
                            var channel = channelIdMap[stream.channel.user_name.toLowerCase()];
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

Hitbox.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /hitbox\.tv\/([\w\-]+)/i
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

Hitbox.prototype.getChannelId = function(channelName) {
    var _this = this;

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!(err instanceof CustomError)) {
            throw err;
        }

        return channelName;
    }).then(function (channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://api.hitbox.tv/media/live/' + encodeURIComponent(channelId),
            qs: {
                showHidden: 'true'
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function(responseBody) {
            var stream = null;
            responseBody.livestream.some(function(item) {
                if (item.channel && item.channel.user_name) {
                    return stream = item;
                }
            });
            if (!stream) {
                throw new CustomError('Channel is not found!');
            }

            var id = stream.channel.user_name.toLowerCase();
            var title = stream.media_display_name || stream.media_user_name || stream.channel.user_name;
            var url = _this.getChannelUrl(id);

            return _this.channels.insertChannel(id, _this.name, title, url);
        });
    });
};

module.exports = Hitbox;