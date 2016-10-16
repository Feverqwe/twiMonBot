/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('hitbox');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var Hitbox = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['hitboxChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.hitboxChannelInfo || {};
    });
};

Hitbox.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        hitboxChannelInfo: this.config.channelInfo
    });
};

Hitbox.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Hitbox.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Hitbox.prototype.setChannelTitle = function (channelId, title) {
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

Hitbox.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

Hitbox.prototype.clean = function(channelIdList) {
    "use strict";
    var _this = this;
    var promiseList = [];

    var needSaveState = false;
    var channelInfo = _this.config.channelInfo;
    Object.keys(channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete channelInfo[channelId];
            needSaveState = true;
            // debug('Removed from channelInfo %s', channelId);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveChannelInfo());
    }

    return Promise.all(promiseList);
};

Hitbox.prototype.apiNormalization = function(data) {
    "use strict";
    var _this = this;

    var now = base.getNow();
    var streamArray = [];
    data.livestream.forEach(function(origItem) {
        if (!origItem.channel || !origItem.channel.user_name || !origItem.media_id) {
            debug('Item without name! %j', origItem);
            return;
        }

        if (origItem.media_is_live < 1) {
            return;
        }

        var channelId = origItem.channel.user_name.toLowerCase();

        var previewList = [];
        if (origItem.media_thumbnail_large) {
            previewList.push(origItem.media_thumbnail_large);
        } else
        if (origItem.media_thumbnail) {
            previewList.push(origItem.media_thumbnail);
        }
        previewList = previewList.map(function(path) {
            var url = 'http://edge.sf.hitbox.tv' + path;
            return base.noCacheUrl(url);
        });

        var item = {
            _service: 'hitbox',
            _checkTime: now,
            _insertTime: now,
            _id: 'h' + origItem.media_id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: parseInt(origItem.media_views) || 0,
            game: origItem.category_name,
            preview: previewList,
            created_at: origItem.media_live_since,
            channel: {
                display_name: origItem.media_display_name,
                name: origItem.media_user_name,
                status: origItem.media_status,
                url: origItem.channel.channel_link
            }
        };

        _this.setChannelTitle(channelId, origItem.media_display_name);

        streamArray.push(item);
    });

    return streamArray;
};

Hitbox.prototype.getStreamList = function(channelList) {
    "use strict";
    var _this = this;
    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var channels = arr.map(function(item) {
            return encodeURIComponent(item);
        }).join(',');

        var retryLimit = 5;
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://api.hitbox.tv/media/live/' + channels,
                qs: {
                    showHidden: 'true'
                },
                json: true,
                gzip: true,
                forever: true
            }).then(function (response) {
                if (response.statusCode !== 200) {
                    debug('Unexpected response %j', response, e);
                    throw new CustomError('Unexpected response');
                }

                return response;
            }).catch(function (err) {
                retryLimit--;
                if (retryLimit > 0) {
                    return new Promise(function (resolve) {
                        return setTimeout(resolve, 5 * 1000);
                    }).then(function () {
                        debug("Retry %s getList", retryLimit, err);
                        return getList();
                    });
                }

                throw err;
            });
        };

        return getList().then(function (response) {
            var responseBody = response.body;
            try {
                var list = _this.apiNormalization(responseBody);
                videoList.push.apply(videoList, list);
            } catch (e) {
                debug('Unexpected response %j', response, e);
                throw new CustomError('Unexpected response');
            }
        }).catch(function (err) {
            arr.forEach(function (channelId) {
                videoList.push(base.getTimeoutStream('hitbox', channelId));
            });
            debug("Request stream list error!", err);
        });
    });

    return Promise.all(promiseList).then(function () {
        return videoList;
    });
};

Hitbox.prototype.getChannelId = function(channelName) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://api.hitbox.tv/media/live/' + encodeURIComponent(channelName),
        qs: {
            showHidden: 'true'
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        if (response.statusCode === 404) {
            throw new CustomError('Channel is not found!');
        }

        var responseBody = response.body;

        var channelId = '';
        try {
            var stream = null;
            responseBody.livestream.some(function(item) {
                if (item.channel && item.channel.user_name) {
                    stream = item;
                    return true;
                }
            });
            if (stream) {
                channelId = stream.channel.user_name.toLowerCase();
            }
        } catch (e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (!channelId) {
            throw new CustomError('Channel is not found!');
        }

        _this.setChannelTitle(channelId, stream.media_display_name);

        return channelId;
    });
};

module.exports = Hitbox;