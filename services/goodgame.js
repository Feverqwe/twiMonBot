/**
 * Created by anton on 19.07.15.
 */
var debug = require('debug')('goodgame');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

GoodGame = function (options) {
    "use strict";
    this.gOptions = options;
};

GoodGame.prototype.apiNormalization = function (data) {
    "use strict";
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

        if (!origItem.thumb) {
            // If don't exists preview, and Live - API bug, it Dead
            debug('Channel thumb is not exists! %j', origItem);
            continue;
        }

        var item = {
            _service: 'goodgame',
            _addItemTime: now,
            _createTime: now,
            _id: origItem.stream_id,
            _isOffline: false,
            _channelName: origItem.key.toLowerCase(),

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.games,
            preview: origItem.thumb,
            created_at: undefined,
            channel: {
                name: origItem.key,
                status: origItem.title,
                logo: origItem.img,
                url: origItem.url
            }
        };

        if (typeof item.preview === 'string') {
            var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
            item.preview = item.preview.replace(/_240(\.jpg)$/, '$1');
            item.preview += sep + '_=' + now;
        }

        streams.push(item);
    }
    return streams;
};

GoodGame.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;

    return Promise.resolve().then(function () {
        if (!channelList.length) {
            return [];
        }

        return requestPromise({
            method: 'GET',
            url: 'http://goodgame.ru/api/getchannelstatus',
            qs: {
                fmt: 'json',
                id: channelList.join(',')
            },
            json: true,
            forever: true
        }).then(function (response) {
            response = response.body;
            return _this.apiNormalization(response);
        });
    });
};

GoodGame.prototype.getChannelName = function (channelName) {
    "use strict";
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
        for (var key in response) {
            var item = response[key];
            if (item.key) {
                return item.key.toLowerCase();
            }
        }

        debug('Channel name "%s" is not found! %j', channelName, response);
        throw 'Channel name is not found!';
    });
};

module.exports = GoodGame;