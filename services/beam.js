/**
 * Created by Anton on 06.04.2017.
 */
"use strict";
const debug = require('debug')('app:beam');
const base = require('../base');
const requestPromise = require('request-promise');
const CustomError = require('../customError').CustomError;

var Beam = function(options) {
    this.super(options);
    this.name = 'beam';
};

Beam.prototype = Object.create(require('./service').prototype);
Beam.prototype.constructor = Beam;

Beam.prototype.isServiceUrl = function (url) {
    return [
        /beam\.pro\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Beam.prototype.getChannelUrl = function (channelName) {
    return 'https://beam.pro/' + channelName;
};

Beam.prototype.insertItem = function (channel, snippet) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (!snippet.online) {
            return;
        }

        var id = snippet.id;

        var previewList = [];
        previewList.push('https://thumbs.beam.pro/channel/' + id + '.big.jpg');

        var url = _this.getChannelUrl(snippet.token);

        var data = {
            viewers: snippet.viewersCurrent || 0,
            game: snippet.type && snippet.type.name || '',
            preview: previewList,
            created_at: snippet.createdAt,
            channel: {
                name: snippet.token,
                status: snippet.name,
                url: url
            }
        };

        var item = {
            id: _this.channels.wrapId(id, _this.name),
            channelId: channel.id,
            data: JSON.stringify(data),
            checkTime: base.getNow(),
            isOffline: 0,
            isTimeout: 0
        };

        var promise = Promise.resolve();
        if (channel.title !== data.channel.name) {
            promise = promise.then(function () {
                channel.title = data.channel.name;
                return _this.channels.updateChannel(channel.id, channel);
            });
        }

        return promise.then(function () {
            return item;
        });
    });
};

var requestPool = new base.Pool(10);

Beam.prototype.getStreamList = function(_channelList) {
    var _this = this;

    var getPage = function (/*dbChannel*/channel) {
        var retryLimit = 1;
        var requestPage = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://beam.pro/api/v1/channels/' + _this.channels.unWrapId(channel.id),
                json: true,
                gzip: true,
                forever: retryLimit === 1
            }).catch(function (err) {
                if (err.statusCode === 404) {
                    debug('Channel is not found', _this.channels.unWrapId(channel.id));
                    return null;
                }

                if (retryLimit-- < 1) {
                    throw err;
                }

                return new Promise(function (resolve) {
                    setTimeout(resolve, 250);
                }).then(function () {
                    // debug('Retry %s requestPage %s', retryLimit, channelId, err);
                    return requestPage();
                });
            });
        };

        return requestPage().then(function (responseBody) {
            if (!responseBody) return;

            return _this.insertItem(channel, responseBody).then(function (item) {
                item && streamList.push(item);
            }).catch(function (err) {
                streamList.push(base.getTimeoutStream(channel));
                debug("insertItem error!", err);
            });
        }).catch(function(err) {
            streamList.push(base.getTimeoutStream(channel));
            debug('Stream list item %s response error!', channel.id, err);
        });
    };

    var promise = Promise.resolve(_channelList);

    promise = promise.then(function (channels) {
        return requestPool.do(function () {
            var channel = channels.shift();
            if (!channel) return;

            return getPage(channel);
        });
    });

    var streamList = [];
    return promise.then(function() {
        return streamList;
    });
};

Beam.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /beam\.pro\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            channelId = m[1];
            return true;
        }
    });
    if (!channelId) {
        return Promise.reject(new CustomError("Is not channel url!"));
    } else {
        return Promise.resolve(channelId);
    }
};

Beam.prototype.getChannelId = function(channelName) {
    var _this = this;

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!(err instanceof CustomError)) {
            throw err;
        }

        return channelName;
    }).then(function (channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://beam.pro/api/v1/channels',
            qs: {
                limit: 1,
                scope: 'names',
                q: channelId
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function (responseBody) {
            var item = null;
            responseBody.some(function (_item) {
                return item = _item;
            });
            if (!item) {
                throw new CustomError('Channel is not found');
            }

            var id = item.token.toLowerCase();
            var title = item.token;
            var url = _this.getChannelUrl(id);

            return _this.channels.insertChannel(id, _this.name, title, url);
        });
    });
};

module.exports = Beam;
