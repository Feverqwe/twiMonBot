/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');
var debugLog = require('debug')('checker:log');
debugLog.log = console.log.bind(console);
var request = require('request');
var requestPromise = Promise.promisify(request);

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error! "%s"', err);
        });
    });

    options.events.on('notify', function(streamItem) {
        _this.notify(streamItem);
    });
};

Checker.prototype.getChannelList = function() {
    "use strict";
    var serviceList = {};
    var chatList = this.gOptions.storage.chatList;

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];
        for (var service in chatItem.serviceList) {
            var channelList = serviceList[service] = serviceList[service] || [];

            var userChannelList = chatItem.serviceList[service];
            for (var i = 0, channelName; channelName = userChannelList[i]; i++) {
                if (channelList.indexOf(channelName) !== -1) {
                    continue;
                }
                channelList.push(channelName);
            }
        }
    }

    return serviceList;
};

Checker.prototype.onSendMsgError = function(err, chatId) {
    err = err && err.message || err;
    var needKick = /^403\s+/.test(err);

    if (!needKick) {
        needKick = /group chat is deactivated/.test(err);
    }

    var jsonRe = /^\d+\s+(\{.+})$/;
    if (jsonRe.test(err)) {
        var msg = null;
        try {
            msg = err.match(jsonRe);
            msg = msg && msg[1];
            msg = JSON.parse(msg);
        } catch (e) {
            msg = null;
        }

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                this.gOptions.chat.chatMigrate(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (!needKick) {
        return;
    }

    this.gOptions.chat.removeChat(chatId);
    return true;
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var retryLimit = 0;

    var maxRetry = _this.gOptions.config.sendPhotoMaxRetry;
    if (maxRetry) {
        retryLimit = maxRetry;
    }

    var previewList = stream.preview;
    if (!Array.isArray(previewList)) {
        previewList = [previewList];
    }

    var sendingPic = function(index, retry) {
        var previewUrl = previewList[index];

        var sendPic = function(request) {
            return Promise.try(function() {
                return _this.gOptions.bot.sendPhoto(chatId, request, {
                    caption: text
                });
            }).then(function (msg) {
                var fileId = msg.photo[0].file_id;

                setTimeout(function() {
                    _this.track(chatId, stream, 'sendPhoto');
                });

                return fileId;
            }).catch(function(err) {
                var imgProcessError = [
                    /IMAGE_PROCESS_FAILED/,
                    /FILE_PART_0_MISSING/
                ].some(function(re) {
                    return re.test(err);
                });

                if (imgProcessError && retry < retryLimit) {
                    retry++;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, 5000);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s! %s", retry, chatId, stream._channelId, err);
                        return sendingPic(index, retry);
                    });
                }

                throw err;
            });
        };

        var onRequestCatch = function(err) {
            debug('Request photo error! %s %s %s %s', index, stream._channelId, previewUrl, err);

            index++;
            if (index >= previewList.length) {
                throw 'Request photo error!';
            }

            return sendingPic(index, retry);
        };

        return requestPromise({
            url: previewUrl,
            encoding: null,
            forever: true
        }).catch(onRequestCatch).then(function(response) {
            if (response.statusCode === 404) {
                return onRequestCatch(new Error('404'));
            }

            var image = new Buffer(response.body, 'binary');
            return sendPic(image);
        });
    };

    return sendingPic(0, 0).catch(function(err) {
        debug('Send photo file error! %s %s %s', chatId, stream._channelId, err);

        var isKicked = _this.onSendMsgError(err, chatId);

        if (isKicked) {
            throw 'Send photo file error! Bot was kicked!';
        }

        throw 'Send photo file error!';
    });
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;
    var chatId = null;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
            disable_web_page_preview: true,
            parse_mode: 'HTML'
        }).then(function() {
            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(err) {
            debug('Send text msg error! %s %s %s', chatId, stream._channelId, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(err) {
            debug('Send photo msg error! %s %s %s', chatId, stream._channelId, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var send = function() {
        var photoId = stream._photoId;
        var promiseList = [];

        while (chatId = chatIdList.shift()) {
            if (!photoId) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPic(chatId, photoId));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview || (Array.isArray(stream.preview) && stream.preview.length === 0)) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    var requestPicId = function() {
        if (!chatIdList.length) {
            debug('chatList is empty! %j', stream);
            return;
        }

        chatId = chatIdList.shift();

        return _this.getPicId(chatId, text, stream).then(function(fileId) {
            stream._photoId = fileId;
        }).catch(function(err) {
            if (err === 'Send photo file error! Bot was kicked!') {
                return requestPicId();
            }

            chatIdList.unshift(chatId);
            debug('Function getPicId throw error!', err);
        });
    };
    return requestPicId().then(function() {
        return send();
    });
};

Checker.prototype.notify = function(stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    Object.keys(chatList).forEach(function (chatId) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
        if (!userChannelList) {
            return;
        }

        if (userChannelList.indexOf(stream._channelId) === -1) {
            return;
        }

        chatIdList.push(chatItem.chatId);
    });

    if (!chatIdList.length) {
        return;
    }

    return this.sendNotify(chatIdList, text, noPhotoText, stream);
};

Checker.prototype.updateList = function() {
    "use strict";
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var queue = Promise.resolve();

    Object.keys(serviceChannelList).forEach(function (service) {
        var currentService = services[service];
        if (!currentService) {
            debug('Service "%s" is not found!', service);
            return;
        }

        var channelList = serviceChannelList[service];

        queue = queue.finally(function() {
            return currentService.getStreamList(channelList).then(function(videoList) {
                _this.gOptions.events.emit('updateLiveList', service, videoList, channelList);
            });
        });

        return queue;
    });

    return queue;
};

Checker.prototype.track = function(chatId, stream, title) {
    "use strict";
    return this.gOptions.tracker.track({
        text: stream._channelId,
        from: {
            id: 1
        },
        chat: {
            id: chatId
        },
        date: parseInt(Date.now() / 1000)
    }, title);
};

module.exports = Checker;