/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('hitbox');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

Hitbox = function(options) {
    "use strict";
    this.gOptions = options;
};

Hitbox.prototype.apiNormalization = function(data) {
    "use strict";
    if (!data || !Array.isArray(data.livestream)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var now = parseInt(Date.now() / 1000);
    var streams = [];
    data.livestream.forEach(function(origItem) {
        if (!origItem.channel || !origItem.channel.user_name) {
            debug('Channel without name! %j', origItem);
            return;
        }

        if (origItem.media_is_live < 1) {
            return;
        }

        var previewList = [];
        if (origItem.media_thumbnail_large) {
            previewList.push(origItem.media_thumbnail_large);
        }
        if (origItem.media_thumbnail) {
            previewList.push(origItem.media_thumbnail);
        }
        previewList = previewList.map(function(path) {
            return 'http://edge.sf.hitbox.tv' + path;
        });

        var item = {
            _service: 'hitbox',
            _addItemTime: now,
            _createTime: now,
            _id: origItem.media_id,
            _isOffline: false,
            _channelName: origItem.channel.user_name.toLowerCase(),

            viewers: parseInt(origItem.media_views) || 0,
            game: '',
            preview: previewList,
            created_at: origItem.media_live_since,
            channel: {
                display_name: origItem.media_display_name,
                name: origItem.media_user_name,
                status: origItem.media_status,
                url: origItem.channel.channel_link
            }
        };

        streams.push(item);
    });

    return streams;
};

Hitbox.prototype.getStreamList = function(channelList) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (!channelList.length) {
            return [];
        }

        var channels = channelList.map(function(item) {
            return encodeURIComponent(item);
        }).join(',');

        return requestPromise({
            method: 'GET',
            url: 'https://api.hitbox.tv/media/live/' + channels,
            qs: {
                showHidden: 'true'
            },
            json: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            return _this.apiNormalization(response);
        });
    });
};

Hitbox.prototype.getChannelName = function(channelName) {
    "use strict";
    return requestPromise({
        method: 'GET',
        url: 'https://api.hitbox.tv/media/live/' + encodeURIComponent(channelName),
        qs: {
            showHidden: 'true'
        },
        json: true,
        forever: true
    }).then(function(response) {
        response = response.body;

        if (!response || !Array.isArray(response.livestream)) {
            debug('Request channelName "%s" is empty %j', channelName, response);
            throw 'Request channelName is empty!';
        }

        var _channelName = null;
        response.livestream.some(function(item) {
            if (item.channel && (_channelName = item.channel.user_name)) {
                _channelName = _channelName.toLowerCase();
                return true;
            }
        });

        if (!_channelName) {
            debug('Channel name "%s" is not found!, %j', channelName, response);
            throw 'Channel name is not found!';
        }

        return _channelName;
    });
};

module.exports = Hitbox;