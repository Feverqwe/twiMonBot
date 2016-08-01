/**
 * Created by anton on 19.07.15.
 */
var debug = require('debug')('goodgame');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var GoodGame = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['ggChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.ggChannelInfo || {};
    });
};

GoodGame.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        ggChannelInfo: this.config.channelInfo
    });
};

GoodGame.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

GoodGame.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

GoodGame.prototype.setChannelTitle = function (channelId, title) {
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

GoodGame.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

GoodGame.prototype.clean = function(channelIdList) {
    "use strict";
    var _this = this;

    Object.keys(this.config.channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            _this.removeChannelInfo(channelId);
            debug('Removed from channelInfo %s', channelId);
        }
    });

    return Promise.resolve();
};

GoodGame.prototype.apiNormalization = function (data) {
    "use strict";
    var _this = this;
    if (!data || typeof data !== 'object') {
        debug('Invalid response! %j', data);
        throw 'Invalid response!';
    }

    var now = base.getNow();
    var streamArray = [];
    Object.keys(data).forEach(function (key) {
        var origItem = data[key];

        if (origItem.status !== 'Live') {
            return;
        }

        delete origItem.embed;
        delete origItem.description;

        if (!origItem.key || !origItem.thumb || !origItem.stream_id) {
            debug('Skip item! %j', origItem);
            return;
        }

        var channelId = origItem.key.toLowerCase();

        var previewList = [];
        if (origItem.thumb) {
            previewList.push(origItem.thumb.replace(/_240(\.jpg)$/, '$1'));
            previewList.push(origItem.thumb);
        }
        previewList = previewList.map(function(url) {
            var sep = !/\?/.test(url) ? '?' : '&';
            return url + sep + '_=' + now;
        });

        var item = {
            _service: 'goodgame',
            _checkTime: now,
            _insertTime: now,
            _id: 'g' + origItem.stream_id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.games,
            preview: previewList,
            created_at: undefined,
            channel: {
                name: origItem.key,
                status: origItem.title,
                url: origItem.url
            }
        };

        _this.setChannelTitle(channelId, origItem.key);

        streamArray.push(item);
    });
    return streamArray;
};

GoodGame.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;

    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var retryLimit = 5;
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'http://goodgame.ru/api/getchannelstatus',
                qs: {
                    fmt: 'json',
                    id: arr.join(',')
                },
                json: true,
                gzip: true,
                forever: true
            }).then(function(response) {
                response = response.body;
                var list = _this.apiNormalization(response);
                videoList.push.apply(videoList, list);
            }).catch(function (err) {
                retryLimit--;
                if (retryLimit < 0) {
                    channelList.forEach(function (channelId) {
                        videoList.push(base.getTimeoutStream('goodgame', channelId));
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

GoodGame.prototype.getChannelId = function (channelName) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'http://goodgame.ru/api/getchannelstatus',
        qs: {
            fmt: 'json',
            id: channelName
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function (response) {
        response = response.body;

        var stream = null;

        for (var key in response) {
            var item = response[key];
            if (item.key) {
                stream = item;
                break;
            }
        }

        if (!stream) {
            debug('Channel "%s" is not found! %j', channelName, response);
            throw 'Channel is not found!';
        }

        var channelId = stream.key.toLowerCase();

        _this.setChannelTitle(channelId, stream.key);

        return channelId;
    });
};

module.exports = GoodGame;