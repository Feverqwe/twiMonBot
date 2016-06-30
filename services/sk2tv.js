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
    if (!Array.isArray(data)) {
        debug('Invalid response! %j', data);
        throw 'Invalid response!';
    }

    var now = base.getNow();
    var streamArray = [];
    data.forEach(function (origItem) {
        if (!origItem.live) {
            return;
        }

        if (!origItem.id) {
            debug('Skip item! %j', origItem);
            return;
        }

        var name = origItem.id;
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
            _service: 'sk2tv',
            _checkTime: now,
            _insertTime: now,
            _id: 's' + channelId,
            _isOffline: false,
            _channelId: channelId,

            viewers: parseInt(origItem.viewers) || 0,
            game: '',
            preview: previewList,
            created_at: undefined,
            channel: {
                name: name,
                status: origItem.title,
                url: 'http://sk2tv.ru/channel/' + channelId
            }
        };

        streamArray.push(item);
    });
    return streamArray;
};

Sk2tv.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;

    var streamList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        return requestPromise({
            method: 'POST',
            url: 'http://funstream.tv/api/player/live',
            body: {
                channels: arr.join(',')
            },
            json: true,
            forever: true
        }).then(function (response) {
            response = response.body;

            var list = _this.apiNormalization(response);
            streamList.push.apply(streamList, list);
        }).catch(function(err) {
            debug('Request stream list error! %j', err);
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
        method: 'POST',
        url: 'http://funstream.tv/api/user',
        body: {
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