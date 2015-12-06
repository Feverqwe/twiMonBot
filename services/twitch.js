/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('twitch');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

Twitch = function(options) {
    "use strict";
    this.gOptions = options;
};

Twitch.prototype.apiNormalization = function(data) {
    "use strict";
    var now = parseInt(Date.now() / 1000);
    var streams = [];
    for (var i = 0, origItem; origItem = data.streams[i]; i++) {
        var item = {
            _service: 'twitch',
            _addItemTime: now,
            _createTime: now,
            _id: origItem._id,
            _isOffline: false,
            _channelName: origItem.channel.name.toLowerCase(),

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.game,
            preview: origItem.preview && origItem.preview.template,
            created_at: origItem.created_at,
            channel: {
                display_name: origItem.channel.display_name,
                name: origItem.channel.name,
                status: origItem.channel.status,
                logo: origItem.channel.logo,
                url: origItem.channel.url
            }
        };

        if (typeof item.preview === 'string') {
            item.preview = item.preview.replace('{width}', '1280').replace('{height}', '720');
            var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
            item.preview += sep + '_=' + now;
        }

        if (!item.channel.url) {
            item.channel.url = 'http://www.twitch.tv/' + item.channel.name;
            if (item.channel.status === undefined) {
                item._isBroken = ['status'];
            }
        }

        streams.push(item);
    }
    return streams;
};

Twitch.prototype.getStreamList = function(channelList) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (!channelList.length) {
            return [];
        }

        return requestPromise({
            method: 'GET',
            url: 'https://api.twitch.tv/kraken/streams',
            qs: {
                limit: 100,
                channel: channelList.join(',')
            },
            headers: {
                'Accept': 'application/vnd.twitchtv.v3+json'
            },
            json: true
        }).then(function(response) {
            return _this.apiNormalization(response);
        });
    });
};

Twitch.prototype.getChannelName = function(channelName) {
    "use strict";
    return requestPromise({
        method: 'GET',
        url: 'https://api.twitch.tv/kraken/channels/' + encodeURIComponent(channelName),
        headers: {
            'Accept': 'application/vnd.twitchtv.v3+json'
        },
        json: true
    }).then(function(response) {
        return response.name.toLowerCase();
    });
};

module.exports = Twitch;