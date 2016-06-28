/**
 * Created by Anton on 28.06.2016.
 */
var debug = require('debug')('cybergame');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var CyberGame = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['cgChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.cgChannelInfo || {};
    });
};

CyberGame.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        cgChannelInfo: this.config.channelInfo
    });
};

CyberGame.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

CyberGame.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

CyberGame.prototype.setChannelTitle = function (channelId, title) {
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

CyberGame.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

CyberGame.prototype.clean = function(channelIdList) {
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

CyberGame.prototype.apiNormalization = function (data) {
    "use strict";
    var _this = this;
    if (!Array.isArray(data)) {
        debug('Invalid response! %j', data);
        throw 'Invalid response!';
    }

    var now = base.getNow();
    var streamArray = [];
    data.forEach(function (origItem) {
        if (!origItem.online) {
            return;
        }

        if (!origItem['channel name']) {
            debug('Skip item! %j', origItem);
            return;
        }

        var name = origItem['channel name'];
        var channelId = name.toLowerCase();

        var previewList = [];
        if (origItem.thumbnail) {
            previewList.push(origItem.thumbnail);
        }
        previewList = previewList.map(function(url) {
            var sep = !/\?/.test(url) ? '?' : '&';
            return url + sep + '_=' + now;
        });

        var item = {
            _service: 'cybergame',
            _checkTime: now,
            _insertTime: now,
            _id: 'c' + channelId,
            _isOffline: false,
            _channelId: channelId,

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.channel_game || '',
            preview: previewList,
            created_at: undefined,
            channel: {
                name: name,
                url: 'http://cybergame.tv/' + channelId + '/'
            }
        };

        streamArray.push(item);
    });
    return streamArray;
};

CyberGame.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;

    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var retryLimit = 5;
        var query = arr.map(function (item) {
            return 'channels[]=' + encodeURIComponent(item)
        }).join('&');
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'http://api.cybergame.tv/w/streams2.php?' + query,
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

CyberGame.prototype.getChannelId = function (channelName) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'http://api.cybergame.tv/w/streams2.php',
        qs: {
            'channels[]': channelName
        },
        json: true,
        forever: true
    }).then(function (response) {
        response = response.body;

        if (!Array.isArray(response)) {
            debug('Bad response %s! %j', channelName, response);
            throw 'Bad response';
        }

        var item = response[0];

        var name = item && item['channel name'];

        if (!name) {
            debug('Channel "%s" is not found! %j', channelName, response);
            throw 'Channel is not found!';
        }

        var channelId = name.toLowerCase();

        _this.setChannelTitle(channelId, name);

        return channelId;
    });
};

module.exports = CyberGame;