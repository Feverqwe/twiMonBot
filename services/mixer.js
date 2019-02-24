/**
 * Created by Anton on 06.04.2017.
 */
"use strict";
const debug = require('debug')('app:mixer');
const base = require('../base');
const CustomError = require('../customError').CustomError;
const got = require('got');
const parallel = require('../tools/parallel');

class Mixer {
    constructor(options) {
        this.gOptions = options;
        this.channels = options.channels;
        this.name = 'mixer';
    }
    isServiceUrl(url) {
        return [
            /mixer\.com\//i
        ].some(function (re) {
            return re.test(url);
        });
    }
    getChannelUrl(channelName) {
        return 'https://mixer.com/' + channelName;
    }
    insertItem(channel, snippet) {
        var _this = this;
        return Promise.resolve().then(function () {
            if (!snippet.online) {
                return;
            }
            var id = snippet.id;
            var previewList = [];
            previewList.push('https://thumbs.mixer.com/channel/' + id + '.big.jpg');
            var url = _this.getChannelUrl(snippet.token);
            var data = {
                isRecord: false,
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
    }
    getStreamList(_channelList) {
        var _this = this;
        var getPage = function (/*dbChannel*/ channel) {
            var retryLimit = 1;
            var requestPage = function () {
                return got('https://mixer.com/api/v1/channels/' + encodeURIComponent(_this.channels.unWrapId(channel.id)), {
                    headers: {
                        'user-agent': ''
                    },
                    json: true,
                }).catch(function (err) {
                    if (err.statusCode === 404) {
                        var isRemovedChannel = false;
                        try {
                            var body = err.body;
                            isRemovedChannel = body.statusCode === 404 &&
                                body.message === 'Channel not found.' &&
                                body.error === 'Not Found';
                        }
                        catch (err) { }
                        if (isRemovedChannel) {
                            debug('Channel is not found, remove! %o', channel.id);
                            return _this.gOptions.channels.removeChannel(channel.id).then(function () {
                                return null;
                            });
                        }
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
            return requestPage().then(function ({body: responseBody}) {
                if (!responseBody)
                    return;
                return _this.insertItem(channel, responseBody).then(function (item) {
                    item && streamList.push(item);
                }).catch(function (err) {
                    streamList.push(base.getTimeoutStream(channel));
                    debug("insertItem error!", err);
                });
            }).catch(function (err) {
                streamList.push(base.getTimeoutStream(channel));
                debug('Stream list item %s response error!', channel.id, err);
            });
        };
        var promise = Promise.resolve(_channelList);
        promise = promise.then(function (channels) {
            return parallel(10, channels, (channel) => {
                return getPage(channel);
            });
        });
        var streamList = [];
        return promise.then(function () {
            return streamList;
        });
    }
    getChannelIdByUrl(url) {
        var channelId = '';
        [
            /mixer\.com\/([\w\-]+)/i
        ].some(function (re) {
            var m = re.exec(url);
            if (m) {
                channelId = m[1];
                return true;
            }
        });
        if (!channelId) {
            return Promise.reject(new CustomError("Is not channel url!"));
        }
        else {
            return Promise.resolve(channelId);
        }
    }
    getChannelId(channelName) {
        var _this = this;
        return _this.getChannelIdByUrl(channelName).catch(function (err) {
            if (!(err instanceof CustomError)) {
                throw err;
            }
            return channelName;
        }).then(function (channelId) {
            return got('https://mixer.com/api/v1/channels', {
                query: {
                    limit: 1,
                    scope: 'names',
                    q: channelId
                },
                headers: {
                    'user-agent': ''
                },
                json: true,
            }).then(({body: responseBody}) => {
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
    }
}

module.exports = Mixer;
