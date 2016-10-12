/**
 * Created by anton on 19.07.15.
 */
var debug = require('debug')('goodgame');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var GoodGame = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['ggChannelInfo']).then(function(storage) {
        _this.config.channelInfo = storage.ggChannelInfo || {};
    });
};

GoodGame.prototype.saveChannelInfo = function () {
    "use strict";
    return base.storage.set({
        ggChannelInfo: this.config.channelInfo
    });
};

GoodGame.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

GoodGame.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

GoodGame.prototype.setChannelTitle = function (channelId, title) {
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

GoodGame.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

GoodGame.prototype.clean = function(channelIdList) {
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

var paramsRe = /\?/;
var noProtocolRe = /^\/\//;

GoodGame.prototype.apiNormalization = function (data) {
    "use strict";
    var _this = this;

    var now = base.getNow();
    var streamArray = [];
    Object.keys(data).forEach(function (key) {
        var origItem = data[key];

        if (origItem.status !== 'Live') {
            return;
        }

        if (!origItem.key || !origItem.thumb || !origItem.stream_id) {
            debug('Skip item! %j', origItem);
            return;
        }

        var channelId = origItem.key.toLowerCase();

        var previewList = [];
        if (origItem.thumb) {
            previewList.push(origItem.thumb.replace(/_240(\.jpg)$/, '$1'));
            previewList.push(origItem.thumb);
        }
        previewList = previewList.map(function(url) {
            if (noProtocolRe.test(url)) {
                url = 'http:' + url;
            }
            var sep = !paramsRe.test(url) ? '?' : '&';
            return url + sep + '_=' + now;
        });

        var item = {
            _service: 'goodgame',
            _checkTime: now,
            _insertTime: now,
            _id: 'g' + origItem.stream_id,
            _isOffline: false,
            _isTimeout: false,
            _channelId: channelId,

            viewers: parseInt(origItem.viewers) || 0,
            game: origItem.games,
            preview: previewList,
            created_at: undefined,
            channel: {
                name: origItem.key,
                status: origItem.title,
                url: origItem.url
            }
        };

        _this.setChannelTitle(channelId, origItem.key);

        streamArray.push(item);
    });
    return streamArray;
};

GoodGame.prototype.getStreamList = function (channelList) {
    "use strict";
    var _this = this;
    var videoList = [];

    var promiseList = base.arrToParts(channelList, 100).map(function (arr) {
        var retryLimit = 5;
        var getList = function () {
            return requestPromise({
                method: 'GET',
                url: 'http://goodgame.ru/api/getchannelstatus',
                qs: {
                    fmt: 'json',
                    id: arr.join(',')
                },
                json: true,
                gzip: true,
                forever: true
            }).then(function(response) {
                if (response.statusCode === 500) {
                    throw new CustomError(response.statusCode);
                }

                if (response.statusCode !== 200) {
                    debug('Unexpected response %j', response);
                    throw new CustomError('Unexpected response');
                }

                return response;
            }).catch(function (err) {
                retryLimit--;
                if (retryLimit > 0) {
                    return new Promise(function(resolve) {
                        return setTimeout(resolve, 5 * 1000);
                    }).then(function() {
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
                videoList.push(base.getTimeoutStream('goodgame', channelId));
            });
            debug("Request stream list error!", err);
        });
    });

    return Promise.all(promiseList).then(function () {
        return videoList;
    });
};

GoodGame.prototype.getChannelId = function (channelName) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'http://goodgame.ru/api/getchannelstatus',
        qs: {
            fmt: 'json',
            id: channelName
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function (response) {
        var responseBody = response.body;

        var stream = null;

        for (var key in responseBody) {
            var item = responseBody[key];
            if (item.key) {
                stream = item;
                break;
            }
        }

        if (!stream) {
            throw new CustomError('Channel is not found!');
        }

        var channelId = stream.key.toLowerCase();

        return _this.setChannelTitle(channelId, stream.key).then(function () {
            return channelId;
        });
    });
};

module.exports = GoodGame;