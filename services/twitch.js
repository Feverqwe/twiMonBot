/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('twitch');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var Twitch = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['twitchChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.twitchChannelInfo || {};
    });
};

Twitch.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        twitchChannelInfo: this.config.channelInfo
    });
};

Twitch.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Twitch.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Twitch.prototype.setChannelTitle = function (channelId, title) {
    "use strict";
    if (channelId === title) {
        return;
    }
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }
};

Twitch.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

Twitch.prototype.clean = function(channelIdList) {
    "use strict";
    var _this = this;

    Object.keys(this.config.channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            _this.removeChannelInfo(channelId);
            // debug('Removed from channelInfo %s', channelId);
        }
    });

    return Promise.resolve();
};

Twitch.prototype.apiNormalization = function(data) {
    "use strict";
    var _this = this;
    /**
     * @type {Array}
     */
    var apiStreams = data && data.streams;
    if (!Array.isArray(apiStreams)) {
        debug('Invalid response! %j', data);
        throw 'Invalid response!';
    }

    var now = base.getNow();

    var invalidArray = [];
    var streamArray = [];
    apiStreams.forEach(function (apiItem) {
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

        previewList = previewList.map(function(url) {
            var sep = !/\?/.test(url) ? '?' : '&';
            return url + sep + '_=' + now;
        });

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

var clientIdRe = /No client id specified/;

Twitch.prototype.getStreamList = function(channelList) {
    "use strict";
    var _this = this;

    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var useClientId = false;
        var retryLimit = 5;
        var getList = function () {
            var headers = {
                'Accept': 'application/vnd.twitchtv.v3+json'
            };

            if (useClientId) {
                headers['Client-ID'] = 'jzkbprff40iqj646a697cyrvl0zt2m6';
            }

            return requestPromise({
                method: 'GET',
                url: 'https://api.twitch.tv/kraken/streams',
                qs: {
                    limit: 100,
                    channel: arr.join(',')
                },
                headers: headers,
                json: true,
                gzip: true,
                forever: true
            }).then(function(response) {
                response = response.body;

                if (!useClientId && clientIdRe.test(response)) {
                    useClientId = true;
                    retryLimit++;
                    throw "Require Client-ID header!";
                }

                var obj = _this.apiNormalization(response);

                videoList.push.apply(videoList, obj.streamArray);

                if (obj.invalidArray.length) {
                    debug('Invalid array %j', obj.invalidArray);
                    arr = obj.invalidArray;
                    throw 'Invalid array!';
                }
            }).catch(function (err) {
                retryLimit--;
                if (retryLimit < 0) {
                    channelList.forEach(function (channelId) {
                        videoList.push(base.getTimeoutStream('twitch', channelId));
                    });
                    debug("Request stream list error! %s", err);
                    return;
                }

                return new Promise(function(resolve) {
                    return setTimeout(resolve, 5 * 1000);
                }).then(function() {
                    debug("Retry request stream list %s! %s", retryLimit, err);
                    return getList();
                });
            });
        };
        return getList();
    });

    return Promise.all(promiseList).then(function () {
        return videoList;
    });
};

Twitch.prototype.requestChannelByName = function (channelName) {
    var useClientId = false;
    var retryLimit = 2;
    var searchChannel = function () {
        var headers = {
            'Accept': 'application/vnd.twitchtv.v3+json'
        };

        if (useClientId) {
            headers['Client-ID'] = 'jzkbprff40iqj646a697cyrvl0zt2m6';
        }

        return requestPromise({
            method: 'GET',
            url: 'https://api.twitch.tv/kraken/search/channels',
            qs: {
                q: channelName,
                limit: 1
            },
            headers: headers,
            json: true,
            gzip: true,
            forever: true
        }).then(function(response) {
            response = response.body;

            if (!useClientId && clientIdRe.test(response)) {
                useClientId = true;
                retryLimit++;
                throw "Require Client-ID header!";
            }

            var firstChannel = response && response.channels && response.channels[0];

            if (!firstChannel || !firstChannel.name) {
                debug('Channel is not found by name! %j', response);
                throw 'Channel is not found by name!';
            }

            return firstChannel;
        }).catch(function (err) {
            retryLimit--;
            if (retryLimit < 0) {
                debug("Request search channel error! %s", err);
                throw err;
            }

            return new Promise(function(resolve) {
                return setTimeout(resolve, 5 * 1000);
            }).then(function() {
                debug("Retry request search channel %s! %s", retryLimit, err);
                return searchChannel();
            });
        });
    };
    return searchChannel();
};

Twitch.prototype.requestChannelInfo = function (channelId) {
    var useClientId = false;
    var retryLimit = 2;
    var getInfo = function () {
        var headers = {
            'Accept': 'application/vnd.twitchtv.v3+json'
        };

        if (useClientId) {
            headers['Client-ID'] = 'jzkbprff40iqj646a697cyrvl0zt2m6';
        }

        return requestPromise({
            method: 'GET',
            url: 'https://api.twitch.tv/kraken/channels/' + encodeURIComponent(channelId),
            headers: headers,
            json: true,
            gzip: true,
            forever: true
        }).then(function(response) {
            response = response.body;

            if (!useClientId && clientIdRe.test(response)) {
                useClientId = true;
                retryLimit++;
                throw "Require Client-ID header!";
            }

            if (!response || !response.name) {
                debug('Channel is not found by id! %j', response);
                throw 'Channel is not found by id!';
            }

            return response;
        }).catch(function (err) {
            retryLimit--;
            if (retryLimit < 0) {
                debug("Request channel info error! %s", err);
                throw err;
            }

            return new Promise(function(resolve) {
                return setTimeout(resolve, 5 * 1000);
            }).then(function() {
                debug("Retry request channel info %s! %s", retryLimit, err);
                return getInfo();
            });
        });
    };
    return getInfo();
};

Twitch.prototype.getChannelId = function(channelId) {
    "use strict";
    var _this = this;
    return this.requestChannelInfo(channelId).catch(function () {
        return _this.requestChannelByName(channelId);
    }).then(function (response) {
        var channelId = response && response.name && response.name.toLowerCase();
        if (!channelId) {
            throw 'Channel is not found!';
        }

        _this.setChannelTitle(channelId, response.display_name);

        return channelId;
    });
};

module.exports = Twitch;