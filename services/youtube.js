/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var apiQuote = new base.Quote(1000);
requestPromise = apiQuote.wrapper(requestPromise.bind(requestPromise));

var Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;

    this.onReady = base.storage.get(['ytChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.ytChannelInfo || {};
        _this.refreshCache();
        return !storage.ytChannelInfo && _this.migrateStorage();
    });
};

Youtube.prototype.migrateStorage = function () {
    var _this = this;
    return base.storage.get(['userIdToChannelId', 'channelIdToTitle']).then(function(storage) {
        var userIdToChannelId = storage.userIdToChannelId || {};
        var channelIdToTitle = storage.channelIdToTitle || {};
        Object.keys(userIdToChannelId).forEach(function (userId) {
            var channelId = userIdToChannelId[userId];
            channelId && _this.setChannelUsername(channelId, userId);
        });
        Object.keys(channelIdToTitle).forEach(function (channelId) {
            var title = channelIdToTitle[channelId];
            if (!channelRe.test(channelId)) {
                channelId = _this.config.userIdToChannelId[channelId];
            }
            title && channelId && _this.setChannelTitle(channelId, title);
        });
    });
};

Youtube.prototype.refreshCache = function () {
    var channelInfo = this.config.channelInfo;
    var userIdToChannelId = this.config.userIdToChannelId = {};
    Object.keys(channelInfo).forEach(function (channelId) {
        var info = channelInfo[channelId];
        if (info.username) {
            userIdToChannelId[info.username] = channelId;
        }
    });
};

Youtube.prototype.apiNormalization = function(userId, data, viewers) {
    "use strict";
    if (!data || !Array.isArray(data.items)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var now = base.getNow();
    var streams = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        if (snippet.liveBroadcastContent !== 'live') {
            return;
        }

        var videoId = origItem.id && origItem.id.videoId;
        if (!videoId) {
            debug('VideoId is not exists! %j', origItem);
            return;
        }

        var previewList = ['maxresdefault_live', 'sddefault_live', 'hqdefault_live', 'mqdefault_live', 'default_live'].map(function(quality) {
            return 'https://i.ytimg.com/vi/' + videoId + '/' + quality + '.jpg';
        });

        var item = {
            _service: 'youtube',
            _checkTime: now,
            _insertTime: now,
            _id: 'y' + videoId,
            _isOffline: false,
            _channelId: userId,

            viewers: viewers || 0,
            game: '',
            preview: previewList,
            created_at: snippet.snippet,
            channel: {
                display_name: snippet.channelTitle,
                name: snippet.channelId,
                status: snippet.title,
                url: 'https://gaming.youtube.com/watch?v=' + videoId
            }
        };

        streams.push(item);
    });
    return streams;
};

Youtube.prototype.saveChannelInfo = function () {
    "use strict";
    this.refreshCache();
    return base.storage.set({
        ytChannelInfo: this.config.channelInfo
    });
};

Youtube.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Youtube.prototype.setChannelTitle = function(channelId, title) {
    "use strict";
    if (channelId === title) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }
};

Youtube.prototype.getChannelTitle = function (channelName) {
    "use strict";
    var channelId = channelName;
    if (!channelRe.test(channelId)) {
        channelId = this.config.userIdToChannelId[channelId];
    }

    var info = this.getChannelInfo(channelId);
    return info.title || channelName;
};

Youtube.prototype.setChannelUsername = function(channelId, username) {
    "use strict";
    if (channelId === username) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.username !== username) {
        info.username = username;
        return this.saveChannelInfo();
    }
};

Youtube.prototype.getViewers = function(id) {
    "use strict";
    return requestPromise({
        url: 'https://gaming.youtube.com/live_stats',
        qs: {
            v: id,
            t: Date.now()
        },
        forever: true
    }).then(function(response) {
        response = response.body;
        if (/^\d+$/.test(response)) {
            return parseInt(response);
        }

        debug('Viewers response is not INT! %s %j', id, response);
        throw 'Viewers response is not INT!';
    }).catch(function(err) {
        debug('Error request viewers!', err);

        return -1;
    });
};

Youtube.prototype.requestChannelIdByQuery = function(query) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: '"' + query + '"',
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        forever: true
    }).then(function(response) {
        response = response.body;
        var id = response && response.items && response.items[0] && response.items[0].id && response.items[0].id.channelId;
        if (!id) {
            debug('Channel ID "%s" is not found by query! %j', query, response);
            throw 'Channel ID is not found by query!';
        }

        return id;
    });
};

var channelRe = /^UC/;

Youtube.prototype.requestChannelIdByUsername = function(userId) {
    "use strict";
    var _this = this;
    return Promise.try(function() {
        if (_this.config.userIdToChannelId[userId]) {
            return _this.config.userIdToChannelId[userId];
        }

        if (channelRe.test(userId)) {
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
            json: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            var id = response && response.items && response.items[0] && response.items[0].id;
            if (!id) {
                debug('Channel ID "%s" is not found by userId! %j', userId, response);
                throw 'Channel ID is not found by userId!';
            }

            return _this.setChannelUsername(id, userId).then(function() {
                return id;
            });
        });
    });
};

Youtube.prototype.getStreamList = function(userList) {
    "use strict";
    var _this = this;

    var streamList = [];

    var requestList = userList.map(function(userId) {
        return _this.requestChannelIdByUsername(userId).then(function(channelId) {
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
                json: true,
                forever: true
            }).then(function(response) {
                response = response.body || {};
                if (!response.items) {
                    debug('Stream list "%s" without item! %j', userId, response);
                    return [];
                }

                if (response.items.length === 0) {
                    return [];
                }

                var videoId = null;
                response.items.some(function(item) {
                    if (item.id && (videoId = item.id.videoId)) {
                        return true;
                    }
                });

                if (!videoId) {
                    debug('VideoId is not found! %j', response);
                    return [];
                }

                return _this.getViewers(videoId).then(function(viewers) {
                    return _this.apiNormalization(userId, response, viewers);
                }).then(function(stream) {
                    streamList.push.apply(streamList, stream);
                });
            });
        }).catch(function(err) {
            debug('Stream list item "%s" response error! %s', userId, err);
        });
    });

    return Promise.all(requestList).then(function() {
        return streamList;
    });
};

Youtube.prototype.getChannelId = function(userId) {
    "use strict";
    var _this = this;

    return _this.requestChannelIdByUsername(userId).catch(function(err) {
        if (err !== 'Channel ID is not found by userId!') {
            throw err;
        }

        return _this.requestChannelIdByQuery(userId).then(function(newUserId) {
            userId = newUserId;
            return _this.requestChannelIdByUsername(userId);
        });
    }).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                channelId: channelId,
                maxResults: 1,
                fields: 'items/snippet',
                key: _this.config.token
            },
            json: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            var snippet = response && response.items && response.items[0] && response.items[0].snippet;
            if (!snippet) {
                debug('Channel "%s" is not found! %j', channelId, response);
                throw 'Channel is not found!';
            }

            var channelTitle = snippet.channelTitle;

            return Promise.try(function() {
                if (!channelTitle || !channelRe.test(userId)) {
                    return;
                }

                var channelTitleLow = channelTitle.toLowerCase();

                return _this.requestChannelIdByUsername(channelTitleLow).then(function(channelId) {
                    if (channelId === userId) {
                        userId = channelTitleLow;
                    }
                }).catch(function() {
                    debug('Channel title "%s" is not equal userId "%s"', channelTitleLow, userId);
                });
            }).then(function() {
                _this.setChannelTitle(channelId, channelTitle);

                return userId;
            });
        });
    });
};

module.exports = Youtube;