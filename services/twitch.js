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
    this.dbTable = 'twChannels';

    this.onReady = _this.init();
};

Twitch.prototype = Object.create(require('./service').prototype);
Twitch.prototype.constructor = Twitch;

Twitch.prototype.isServiceUrl = function (url) {
    return [
        /twitch\.tv\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Twitch.prototype.init = function () {
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

Twitch.prototype.getStreamList = function(_channelIdsList) {
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
                var retryLimit = 5;
                var getList = function () {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://api.twitch.tv/kraken/streams',
                        qs: {
                            limit: 100,
                            channel: channelIds.join(',')
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
                        channelIds = obj.invalidArray;
                        throw new CustomError('Invalid array!');
                    }
                }).catch(function (err) {
                    channelIds.forEach(function (channelId) {
                        videoList.push(base.getTimeoutStream('twitch', channelId));
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
        return responseBody;
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
        var channel = null;
        responseBody.channels.some(function (item) {
            return channel = item;
        });
        if (!channel) {
            throw new CustomError('Channel is not found by name!');
        }
        return channel;
    });
};

Twitch.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /twitch\.tv\/([^\/]+)/i
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

Twitch.prototype.getChannelId = function(channelName) {
    var _this = this;

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        return channelName;
    }).then(function (channelId) {
        return _this.requestChannelInfo(channelId).catch(function (err) {
            return _this.requestChannelByName(channelId);
        }).then(function (channelInfo) {
            var id = channelInfo.name.toLowerCase();
            var title = channelInfo.display_name;

            return _this.setChannelInfo({
                id: id,
                title: title
            }).then(function () {
                return id;
            });
        });
    });
};

module.exports = Twitch;