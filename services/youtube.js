/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['userIdToChannelId', 'channelIdToTitle']).then(function(storage) {
        _this.config.token = options.config.ytToken;
        _this.config.userIdToChannelId = storage.userIdToChannelId || {};
        _this.config.channelIdToTitle = storage.channelIdToTitle || {};
    });
};

Youtube.prototype.clean = function(channelList) {
    "use strict";
    var _this = this;
    var userIdToChannelId = _this.config.userIdToChannelId;
    var channelIdToTitle = _this.config.channelIdToTitle;

    var needSave = false;

    for (var userId in userIdToChannelId) {
        if (channelList.indexOf(userId) === -1) {
            delete userIdToChannelId[userId];
            needSave = true;
            debug('Removed from userIdToChannelId %s', userId);
        }
    }

    for (var channelId in channelIdToTitle) {
        if (channelList.indexOf(channelId) === -1) {
            delete channelIdToTitle[channelId];
            needSave = true;
            debug('Removed from channelIdToTitle %s', channelId);
        }
    }

    var promise = Promise.resolve();

    if (needSave) {
        promise = promise.then(function() {
            return base.storage.set({
                userIdToChannelId: userIdToChannelId,
                channelIdToTitle: channelIdToTitle
            });
        });
    }

    return promise;
};

Youtube.prototype.apiNormalization = function(userId, data, viewers) {
    "use strict";
    if (!data || !Array.isArray(data.items)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var now = parseInt(Date.now() / 1000);
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

Youtube.prototype.setChannelTitle = function(channelId, channelTitle) {
    "use strict";
    var channelIdToTitle = this.config.channelIdToTitle;
    if (!channelTitle) {
        debug('channelTitle is empty! %s', channelId);
        return;
    }

    if (channelIdToTitle[channelId] === channelTitle) {
        return;
    }

    channelIdToTitle[channelId] = channelTitle;
    base.storage.set({channelIdToTitle: channelIdToTitle});
};

Youtube.prototype.getChannelTitle = function(channelId) {
    "use strict";
    var channelIdToTitle = this.config.channelIdToTitle;

    return channelIdToTitle[channelId] || channelId;
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

Youtube.prototype.searchChannelIdByTitle = function(channelTitle) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: '"' + channelTitle + '"',
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
            debug('Channel ID "%s" is not found by query! %j', channelTitle, response);
            throw 'Channel ID is not found by query!';
        }

        return id;
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
            json: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            var id = response && response.items && response.items[0] && response.items[0].id;
            if (!id) {
                debug('Channel ID "%s" is not found by userId! %j', userId, response);
                throw 'Channel ID is not found by userId!';
            }

            _this.config.userIdToChannelId[userId] = id;
            return base.storage.set({userIdToChannelId: _this.config.userIdToChannelId}).then(function() {
                return id;
            });
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
            return _this.getChannelId(userId).then(function(channelId) {
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
                    response = response.body;
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
    });
};

Youtube.prototype.getChannelName = function(userId) {
    "use strict";
    var _this = this;

    return _this.getChannelId(userId).catch(function(err) {
        if (err !== 'Channel ID is not found by userId!') {
            throw err;
        }

        return _this.searchChannelIdByTitle(userId).then(function(newUserId) {
            userId = newUserId;
            return _this.getChannelId(userId);
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
                if (!channelTitle || !/^UC/.test(userId)) {
                    return;
                }

                var channelTitleLow = channelTitle.toLowerCase();

                return _this.getChannelId(channelTitleLow).then(function(channelId) {
                    if (channelId === userId) {
                        userId = channelTitleLow;
                    }
                }).catch(function() {
                    debug('Channel title "%s" is not equal userId "%s"', channelTitleLow, userId);
                });
            }).then(function() {
                _this.setChannelTitle(userId, channelTitle);

                return userId;
            });
        });
    });
};

module.exports = Youtube;