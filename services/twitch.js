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
    this.gOptions = options;
};

Twitch.prototype.apiNormalization = function(data) {
    "use strict";
    if (!data || !Array.isArray(data.streams)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var now = parseInt(Date.now() / 1000);
    var streams = [];
    for (var i = 0, origItem; origItem = data.streams[i]; i++) {
        if (!origItem.channel || !origItem.channel.name) {
            debug('Channel without name!');
            continue;
        }

        var previewList = [];
        origItem.preview && ['template', 'large', 'medium', 'small'].forEach(function(quality) {
            var url = origItem.preview[quality];
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

        if (previewList.length === 0) {
            previewList = null;
        }

        var item = {
            _service: 'twitch',
            _addItemTime: now,
            _createTime: now,
            _id: origItem._id,
            _isOffline: false,
            _channelName: origItem.channel.name.toLowerCase(),

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.game,
            preview: previewList,
            created_at: origItem.created_at,
            channel: {
                display_name: origItem.channel.display_name,
                name: origItem.channel.name,
                status: origItem.channel.status,
                logo: origItem.channel.logo,
                url: origItem.channel.url
            }
        };

        if (!item.channel.url) {
            item.channel.url = 'http://www.twitch.tv/' + item.channel.name;
        }

        streams.push(item);
    }
    return streams;
};

Twitch.prototype.getStreamList = function(channelList) {
    "use strict";
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
                    'Accept': 'application/vnd.twitchtv.v3+json'
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

Twitch.prototype.getChannelName = function(channelName) {
    "use strict";
    return requestPromise({
        method: 'GET',
        url: 'https://api.twitch.tv/kraken/channels/' + encodeURIComponent(channelName),
        headers: {
            'Accept': 'application/vnd.twitchtv.v3+json'
        },
        json: true,
        forever: true
    }).then(function(response) {
        response = response.body;

        if (!response || !response.name) {
            debug('Channel name "%s" is not exists! %j', channelName, response);
            throw 'Channel name is not exists!';
        }

        return response.name.toLowerCase();
    });
};

module.exports = Twitch;