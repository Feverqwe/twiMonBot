/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:hitbox');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = require('request-promise');
var CustomError = require('../customError').CustomError;

var Hitbox = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.dbTable = 'hbChannels';

    this.onReady = _this.init();
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

Hitbox.prototype.init = function () {
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

Hitbox.prototype.clean = function(channelIdList) {
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

Hitbox.prototype.insertItem = function (channel, stream) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (stream.media_is_live < 1) {
            return;
        }

        var now = base.getNow();

        var id = stream.media_id;
        var viewers = parseInt(stream.media_views) || 0;
        var game = stream.category_name;
        var createdAt = stream.media_live_since;
        var channelTitle = stream.media_display_name;
        var channelName = stream.media_user_name;

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

        var item = {
            _service: 'hitbox',
            _checkTime: now,
            _insertTime: now,
            _id: 'h' + id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channel.id,

            viewers: viewers,
            game: game,
            preview: previewList,
            created_at: createdAt,
            channel: {
                display_name: channelTitle,
                name: channelName,
                status: stream.media_status,
                url: stream.channel.channel_link
            }
        };

        var promise = Promise.resolve();
        if (channelTitle && channel.title !== channelTitle) {
            promise = promise.then(function () {
                return _this.setChannelTitle(channel.id, channelTitle);
            });
        }

        return promise.then(function () {
            return item;
        });
    });
};

var insertPool = new base.Pool(15);

Hitbox.prototype.getStreamList = function(_channelIdsList) {
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

        base.arrToParts(channels, 100).forEach(function (channelsPart) {
            var channelIds = channelsPart.map(function (channel) {
                return channel.id;
            });

            queue = queue.then(function () {
                var query = channelIds.map(function (item) {
                    return encodeURIComponent(item);
                }).join(',');

                var retryLimit = 5;
                var getList = function () {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://api.hitbox.tv/media/live/' + query,
                        qs: {
                            showHidden: 'true'
                        },
                        json: true,
                        gzip: true,
                        forever: true
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

                        if (!stream.channel || !stream.channel.user_name) {
                            debug('ChannelId is empty! %j', stream);
                            return Promise.resolve();
                        }

                        var channelId = stream.channel.user_name.toLowerCase();
                        var pos = channelIds.indexOf(channelId);
                        if (pos === -1) {
                            debug('Channel is not required! %s', channelId);
                            return Promise.resolve();
                        }
                        var channel = channelsPart[pos];

                        return _this.insertItem(channel, stream).then(function (item) {
                            item && videoList.push(item);
                        }).catch(function (err) {
                            videoList.push(base.getTimeoutStream('hitbox', channel.id));
                            debug("insertItem error!", err);
                        });
                    });
                }).catch(function (err) {
                    channelIds.forEach(function (channelId) {
                        videoList.push(base.getTimeoutStream('hitbox', channelId));
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

Hitbox.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /hitbox\.tv\/([^\/]+)/i
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
        if (!err instanceof CustomError) {
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

            var username = stream.channel.user_name.toLowerCase();
            var title = stream.media_display_name;

            return _this.setChannelInfo({
                id: username,
                title: title
            }).then(function () {
                return {
                    id: username,
                    title: title
                };
            });
        });
    });
};

module.exports = Hitbox;