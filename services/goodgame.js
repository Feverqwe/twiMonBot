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
    return base.storage.set({
        ggChannelInfo: this.config.channelInfo
    });
};

GoodGame.prototype.getChannelInfo = function (channelId) {
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

GoodGame.prototype.setChannelTitle = function (channelId, title) {
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }
};

GoodGame.prototype.getChannelTitle = function (channelId) {
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

GoodGame.prototype.apiNormalization = function (data) {
    "use strict";
    var _this = this;
    if (!data || typeof data !== 'object') {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var now = parseInt(Date.now() / 1000);
    var streams = [];
    for (var streamId in data) {
        var origItem = data[streamId];

        delete origItem.embed;
        delete origItem.description;

        if (origItem.status !== 'Live') {
            continue;
        }

        if (!origItem.key) {
            debug('Channel without name! %j', origItem);
            continue;
        }

        var channelId = origItem.key.toLowerCase();

        if (!origItem.thumb) {
            // If don't exists preview, and Live - API bug, it Dead
            debug('Channel thumb is not exists! %j', origItem);
            continue;
        }

        var previewList = [];
        if (origItem.thumb) {
            previewList.push(origItem.thumb.replace(/_240(\.jpg)$/, '$1'));
            previewList.push(origItem.thumb);
        }
        previewList = previewList.map(function(url) {
            var sep = !/\?/.test(url) ? '?' : '&';
            return url + sep + '_=' + now;
        });

        if (previewList.length === 0) {
            previewList = null;
        }

        var item = {
            _service: 'goodgame',
            _addItemTime: now,
            _createTime: now,
            _id: origItem.stream_id,
            _isOffline: false,
            _channelName: channelId,

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.games,
            preview: previewList,
            created_at: undefined,
            channel: {
                name: origItem.key,
                status: origItem.title,
                logo: origItem.img,
                url: origItem.url
            }
        };

        _this.setChannelTitle(channelId, origItem.key);

        streams.push(item);
    }
    return streams;
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
                forever: true
            }).then(function(response) {
                response = response.body;
                var list = _this.apiNormalization(response);
                videoList.push.apply(videoList, list);
            }).catch(function (err) {
                retryLimit--;
                if (retryLimit < 0) {
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

GoodGame.prototype.requestChannelId = function (channelName) {
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

        if (!item) {
            debug('Channel "%s" is not found! %j', channelName, response);
            throw 'Channel is not found!';
        }

        var channelId = item.key.toLowerCase();

        _this.setChannelTitle(channelId, item.key);

        return channelId;
    });
};

module.exports = GoodGame;