/**
 * Created by anton on 19.07.15.
 */
var debug = require('debug')('sk2tv');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var Sk2tv = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['skChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.skChannelInfo || {};
    });
};

Sk2tv.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        skChannelInfo: this.config.channelInfo
    });
};

Sk2tv.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Sk2tv.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Sk2tv.prototype.setChannelTitle = function (channelId, title) {
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

Sk2tv.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

Sk2tv.prototype.clean = function(channelIdList) {
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

Sk2tv.prototype.apiNormalization = function (data) {
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

Sk2tv.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;

    var streamList = [];

    var promiseList = channelList.map(function (channelId) {
        return requestPromise({
            method: 'GET',
            url: 'http://funstream.tv/api/stream',
            qs: {
                owner: channelId
            },
            json: true,
            forever: true
        }).then(function (response) {
            response = response.body || {};
            if (!response.id) {
                return;
            }

            var list = _this.apiNormalization(channelId, response);
            streamList.push.apply(streamList, list);
        }).catch(function(err) {
            debug('Stream list item "%s" response error! %s', channelId, err);
        });
    });

    return Promise.all(promiseList).then(function () {
        return streamList;
    });
};

Sk2tv.prototype.getChannelId = function (channelName) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'http://funstream.tv/api/user',
        qs: {
            fmt: 'json',
            name: channelName
        },
        json: true,
        forever: true
    }).then(function (response) {
        response = response.body || {};
        var name = response.name;

        if (!name) {
            debug('Channel "%s" is not found! %j', channelName, response);
            throw 'Channel is not found!';
        }

        var channelId = name.toLowerCase();

        _this.setChannelTitle(channelId, name);

        return channelId;
    });
};

module.exports = Sk2tv;