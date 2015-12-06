/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('twitch');
var base = require('./base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    options.storage.get('userIdToChannelId').then(function(storage) {
        _this.config.token = options.config.ytToken;
        _this.config.userIdToChannelId = storage.userIdToChannelId || {};
    });
};

Youtube.prototype.apiNormalization = function(userId, data, viewers) {
    "use strict";
    var now = parseInt(Date.now() / 1000);
    var streams = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        if (snippet.liveBroadcastContent !== 'live') {
            return;
        }

        var videoId = origItem.id && origItem.id.videoId;
        if (!videoId) {
            return;
        }

        var item = {
            _service: 'youtube',
            _addItemTime: now,
            _createTime: now,
            _id: videoId,
            _isOffline: false,
            _channelName: userId,

            viewers: viewers || 0,
            game: '',
            preview: 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault_live.jpg',
            created_at: snippet.snippet,
            channel: {
                display_name: snippet.channelTitle,
                name: snippet.channelId,
                status: snippet.title,
                url: 'https://gaming.youtube.com/watch?v=' + videoId
            }
        };

        if (typeof item.preview === 'string') {
            var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
            item.preview += sep + '_=' + now;
        }

        streams.push(item);
    });
    return streams;
};

Youtube.prototype.getViewers = function(id) {
    "use strict";
    requestPromise({
        url: 'https://gaming.youtube.com/live_stats',
        qs: {
            v: id,
            t: Date.now()
        }
    }).then(function(data) {
        if (/^\d+$/.test(data)) {
            return parseInt(data);
        }

        throw new Error('Value is not int');
    }).catch(function(err) {
        debug(base.getDate(), 'Error request viewers!', err);
    });
};

Youtube.prototype.getChannelId = function(userId) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (_this.config.userIdToChannelId[userId]) {
            return _this.config.userIdToChannelId[userId];
        }

        if (/^UC/.test(userId)) {
            return userId;
        }

        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/channels',
            qs: {
                part: 'snippet',
                forUsername: userId,
                maxResults: 1,
                fields: 'items/id',
                key: _this.config.token
            },
            json: true
        }).then(function(data) {
            var id = data.items[0].id;

            _this.config.userIdToChannelId[userId] = id;
            base.storage.set({userIdToChannelId: _this.config.userIdToChannelId});

            return id;
        }).catch(function(err) {
            debug(base.getDate(), 'Request getChannelId error!', err);
        });
    });
};

Youtube.prototype.getStreamList = function(userList) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (!userList.length) {
            return [];
        }

        var streamList = [];

        var requestList = userList.map(function(userId) {
            return new Promise(function(resolve) {
                _this.getChannelId(userId).then(function(channelId) {
                    return requestPromise({
                        method: 'GET',
                        url: 'https://www.googleapis.com/youtube/v3/search',
                        qs: {
                            part: 'snippet',
                            channelId: channelId,
                            eventType: 'live',
                            maxResults: 1,
                            order: 'date',
                            safeSearch: 'none',
                            type: 'video',
                            fields: 'items(id,snippet)',
                            key: _this.config.token
                        },
                        json: true
                    }).then(function(data) {
                        if (data.items.length === 0) {
                            return [];
                        }

                        var videoId = null;
                        data.items.some(function(item) {
                            if (item.id && (videoId = item.id.videoId)) {
                                return true;
                            }
                        });

                        if (!videoId) {
                            debug(base.getDate(), 'VideoId is not found!');
                            return [];
                        }

                        return _this.getViewers(videoId).catch(function() {
                            return -1;
                        }).finally(function(viewers) {
                            return _this.apiNormalization(userId, data, viewers);
                        });
                    });
                }).then(function(stream) {
                    streamList.push(stream);
                }).catch(function(err) {
                    debug(base.getDate(), 'Stream list item response error!', err);
                }).finally(function() {
                    resolve();
                });
            });
        });

        return Promise.all(requestList).then(function() {
            return streamList;
        });
    }).catch(function(err) {
        debug(base.getDate(), 'Request streamList error!', err);
    });
};

Youtube.prototype.getChannelName = function(userId) {
    "use strict";
    var _this = this;

    return _this.getChannelId(userId).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                id: channelId,
                maxResults: 1,
                fields: 'items(id,snippet)',
                key: _this.config.token
            },
            json: true
        }).then(function(data) {
            var id = data && data.items && data.items[0] && data.items[0].id;
            if (!id) {
                return null;
            }

            return {userId: userId, channelId: id === userId ? undefined : id};
        }).catch(function(err) {
            debug(base.getDate(), 'Request channelName error!', err);
        });
    });
};

module.exports = Youtube;