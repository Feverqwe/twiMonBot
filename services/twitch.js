/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('twitch');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var Twitch = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.twitchToken;

    this.onReady = base.storage.get(['twitchChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.twitchChannelInfo || {};
    });
};

Twitch.prototype.saveChannelInfo = function () {
    return base.storage.set({
        twitchChannelInfo: this.config.channelInfo
    });
};

Twitch.prototype.getChannelInfo = function (channelId) {
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Twitch.prototype.removeChannelInfo = function (channelId) {
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Twitch.prototype.setChannelTitle = function (channelId, title) {
    if (channelId === title) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }
};

Twitch.prototype.getChannelTitle = function (channelId) {
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

Twitch.prototype.clean = function(channelIdList) {
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

    return Promise.all(promiseList);
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

        _this.setChannelTitle(channelId, apiItem.channel.display_name);

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
                retryLimit--;
                if (retryLimit > 0) {
                    return new Promise(function(resolve) {
                        return setTimeout(resolve, 250);
                    }).then(function() {
                        // debug("Retry %s getList", retryLimit, err);
                        return getList();
                    });
                }

                throw err;
            });
        };

        return getList().then(function (response) {
            var responseBody = response.body;

            var obj = null;
            try {
                obj = _this.apiNormalization(responseBody);
            } catch (e) {
                debug('Unexpected response %j', response, e);
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
    }).then(function(response) {
        var responseBody = response.body;

        var firstChannel = null;
        try {
            if (responseBody.channels.length > 0) {
                firstChannel = responseBody.channels[0];
            }
        } catch (e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (!firstChannel) {
            throw new CustomError('Channel is not found by name!');
        }

        var name = firstChannel.name;
        if (!name || typeof name !== 'string') {
            debug('Unexpected response %j', response, e);
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
    }).then(function(response) {
        var responseBody = response.body;

        if (!responseBody) {
            throw new CustomError('Channel is not found by id!');
        }

        var name = responseBody.name;
        if (!name || typeof name !== 'string') {
            debug('Unexpected response %j', response, e);
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

        _this.setChannelTitle(channelId, channelInfo.display_name);

        return channelId;
    });
};

module.exports = Twitch;