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
    });
};

Youtube.prototype.saveChannelInfo = function () {
    "use strict";
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

Youtube.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Youtube.prototype.setChannelTitle = function(channelId, title) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }

    return Promise.resolve();
};

Youtube.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

Youtube.prototype.setChannelUsername = function(channelId, username) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    if (info.username !== username) {
        info.username = username;
        return this.saveChannelInfo();
    }

    return Promise.resolve();
};

Youtube.prototype.clean = function(channelIdList) {
    "use strict";
    var _this = this;

    Object.keys(this.config.channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
            _this.removeChannelInfo(channelId);
        }
    });

    return Promise.resolve();
};

Youtube.prototype.apiNormalization = function(channelId, data, viewers) {
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
            _isTimeout: false,
            _channelId: channelId,

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

Youtube.prototype.getViewers = function(id) {
    "use strict";
    return requestPromise({
        url: 'https://gaming.youtube.com/live_stats',
        qs: {
            v: id,
            t: Date.now()
        },
        gzip: true,
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
        gzip: true,
        forever: true
    }).then(function(response) {
        response = response.body;
        var id = response && response.items && response.items[0] && response.items[0].id && response.items[0].id.channelId;
        if (!id) {
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
            gzip: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            var id = response && response.items && response.items[0] && response.items[0].id;
            if (!id) {
                throw 'Channel ID is not found by userId!';
            }

            return _this.setChannelUsername(id, userId).then(function() {
                return id;
            });
        });
    });
};

Youtube.prototype.getStreamList = function(channelIdList) {
    "use strict";
    var _this = this;

    var streamList = [];

    var requestList = channelIdList.map(function(channelId) {
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
            gzip: true,
            forever: true
        }).then(function(response) {
            response = response.body || {};
            if (!response.items) {
                debug('Stream list "%s" without item! %j', channelId, response);
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
                return _this.apiNormalization(channelId, response, viewers);
            }).then(function(stream) {
                streamList.push.apply(streamList, stream);
            });
        }).catch(function(err) {
            streamList.push(base.getTimeoutStream('youtube', channelId));
            debug('Stream list item "%s" response error! %s', channelId, err);
        });
    });

    return Promise.all(requestList).then(function() {
        return streamList;
    });
};

Youtube.prototype.requestChannelIdByVideoUrl = function (url) {
    var _this = this;

    var videoId = '';
    [
        /\/\/(?:[^\/]+\.)?youtu\.be\/([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/.+[?&]v=([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            videoId = m[1];
            return true;
        }
    });

    if (!videoId) {
        return Promise.reject('It not video url!');
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/videos',
        qs: {
            part: 'snippet',
            id: videoId,
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        response = response.body;

        var id = response && response.items && response.items[0] && response.items[0].snippet && response.items[0].snippet.channelId;
        if (!id) {
            throw 'Channel ID is not found by videoId!';
        }

        return id;
    });
};

Youtube.prototype.getChannelId = function(channelName) {
    "use strict";
    var _this = this;

    return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
        if (err !== 'Channel ID is not found by videoId!' && err !== 'It not video url!') {
            throw err;
        }

        return _this.requestChannelIdByUsername(channelName).catch(function(err) {
            if (err !== 'Channel ID is not found by userId!') {
                throw err;
            }

            return _this.requestChannelIdByQuery(channelName).then(function(channelId) {
                channelName = channelId;
                return _this.requestChannelIdByUsername(channelId);
            });
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
            gzip: true,
            forever: true
        }).then(function(response) {
            response = response.body;
            var snippet = response && response.items && response.items[0] && response.items[0].snippet;
            if (!snippet) {
                debug('Channel "%s" is not found! %j', channelId, response);
                throw 'Channel is not found!';
            }

            var channelTitle = snippet.channelTitle;

            return _this.setChannelTitle(channelId, channelTitle).then(function () {
                return channelId;
            });
        });
    });
};

module.exports = Youtube;