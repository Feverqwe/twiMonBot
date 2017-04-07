/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:beam');
const base = require('../base');
const requestPromise = require('request-promise');
const CustomError = require('../customError').CustomError;

var Beam = function(options) {
    var _this = this;
    this.name = 'beam';
    this.gOptions = options;
    this.dbTable = 'bChannels';

    this.onReady = _this.init();
};

Beam.prototype = Object.create(require('./service').prototype);
Beam.prototype.constructor = Beam;

Beam.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS ' + _this.dbTable + ' ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `title` TEXT CHARACTER SET utf8mb4 NULL, \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC)); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    return promise;
};

Beam.prototype.isServiceUrl = function (url) {
    return [
        /beam\.pro\//i
    ].some(function (re) {
        return re.test(url);
    });
};

Beam.prototype.getChannelUrl = function (channelId) {
    return 'https://beam.pro/' + channelId;
};

Beam.prototype.clean = function(channelIdList) {
    // todo: fix me
    return Promise.resolve();
};

var videoIdToId = function (videoId) {
    return 'b:' + videoId;
};

Beam.prototype.insertItem = function (channel, snippet) {
    var _this = this;
    return Promise.resolve().then(function () {
        if (!snippet.online) {
            return;
        }

        var now = base.getNow();

        var id = snippet.id;

        var previewList = [];
        previewList.push('https://thumbs.beam.pro/channel/' + id + '.big.jpg');

        var game = snippet.type && snippet.type.name;

        var viewers = snippet.viewersCurrent || 0;

        var createdAt = snippet.createdAt;
        var status = snippet.name;
        var channelTitle = snippet.token;
        var url = 'https://beam.pro/' + channelTitle;

        var data = {
            _service: _this.name,
            _checkTime: now,
            _insertTime: now,
            _id: videoIdToId(id),
            _isOffline: false,
            _isTimeout: false,
            _channelId: channel.id,

            viewers: viewers,
            game: game,
            preview: previewList,
            created_at: createdAt,
            channel: {
                name: channelTitle,
                status: status,
                url: url
            }
        };

        var item = {
            id: videoIdToId(id),
            channelId: channel.id,
            service: _this.name,
            data: JSON.stringify(data),
            checkTime: base.getNow(),
            isOffline: 0,
            isTimeout: 0
        };

        var promise = Promise.resolve();
        if (channelTitle && channel.title !== channelTitle) {
            promise = promise.then(function () {
                return _this.setChannelTitle(channel.id, channelTitle);
            });
        }

        return promise.then(function () {
            return item;
        });
    });
};

var requestPool = new base.Pool(10);

Beam.prototype.getStreamList = function(_channelIdsList) {
    var _this = this;

    var getPage = function (channel) {
        var channelId = channel.id;

        var retryLimit = 1;
        var requestPage = function () {
            return requestPromise({
                method: 'GET',
                url: 'https://beam.pro/api/v1/channels/' + channelId,
                json: true,
                gzip: true,
                forever: true
            }).catch(function (err) {
                if (err.statusCode === 404) {
                    debug('Channel is not found %o', err);
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
                streamList.push(base.getTimeoutStream(_this.name, channel.id));
                debug("insertItem error!", err);
            });
        }).catch(function(err) {
            streamList.push(base.getTimeoutStream(_this.name, channelId));
            debug('Stream list item %s response error!', channelId, err);
        });
    };

    var promise = Promise.resolve();

    promise = promise.then(function () {
        return _this.getChannelsInfo(_channelIdsList).then(function (channels) {
            if (_channelIdsList.length !== channels.length) {
                var foundIds = channels.map(function (channel) {
                    return channel.id;
                });
                var notFoundIds = _channelIdsList.filter(function (id) {
                    return foundIds.indexOf(id) === -1;
                });
                debug('Not found channels %j', notFoundIds);
            }
            return channels;
        });
    });

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

Beam.prototype.getChannelId = function(channelName) {
    var _this = this;

    var channel = {
        id: null,
        title: null
    };

    return requestPromise({
        method: 'GET',
        url: 'https://beam.pro/api/v1/channels',
        qs: {
            limit: 1,
            scope: 'names',
            q: channelName
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var item = null;
        responseBody.some(function (_item) {
            return item = _item;
        });
        if (!item) {
            throw new CustomError('Channel is not found');
        }

        channel.id = item.token.toLowerCase();
        channel.title = item.token;

        return _this.setChannelInfo(channel).then(function () {
            return channel;
        });
    });
};

module.exports = Beam;