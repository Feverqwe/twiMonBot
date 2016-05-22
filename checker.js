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

    options.events.on('updateNotify', function(streamItem) {
        _this.updateNotify(streamItem);
    });

    options.events.on('clean', function() {
        _this.cleanServices();
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
    var sendPicLimit = 0;
    var sendPicTimeoutSec = 5;
    var requestLimit = 0;
    var requestTimeoutSec = 30;
    var tryNumber = 1;

    var refreshRetryLimit = function () {
        var _retryLimit = _this.gOptions.config.sendPhotoMaxRetry;
        if (_retryLimit) {
            sendPicLimit = _retryLimit;
        }

        var _retryTimeoutSec = _this.gOptions.config.sendPhotoRetryTimeoutSec;
        if (_retryTimeoutSec) {
            sendPicTimeoutSec = _retryTimeoutSec;
        }

        sendPicTimeoutSec *= 1000;
    };
    refreshRetryLimit();

    var refreshRequestLimit = function () {
        var _requestLimit = _this.gOptions.config.sendPhotoRequestLimit;
        if (_requestLimit) {
            requestLimit = _requestLimit;
        }

        var _requestTimeoutSec = _this.gOptions.config.sendPhotoRequestTimeoutSec;
        if (_requestTimeoutSec) {
            requestTimeoutSec = _requestTimeoutSec;
        }

        requestTimeoutSec *= 1000;
    };
    refreshRequestLimit();

    var previewList = stream.preview;

    var sendingPic = function() {
        var sendPic = function(request) {
            return Promise.try(function() {
                return _this.gOptions.bot.sendPhoto(chatId, request, {
                    caption: text
                });
            }).catch(function(err) {
                var imgProcessError = [
                    /IMAGE_PROCESS_FAILED/,
                    /FILE_PART_0_MISSING/
                ].some(function(re) {
                    return re.test(err);
                });

                if (imgProcessError && sendPicLimit > 0) {
                    sendPicLimit--;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, sendPicTimeoutSec);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s! %s", sendPicLimit, chatId, stream._channelId, err);
                        refreshRequestLimit();
                        return sendingPic();
                    });
                }

                throw err;
            });
        };

        var picIndex = null;
        var requestPic = function (index) {
            var previewUrl = previewList[index];
            return requestPromise({
                url: previewUrl,
                encoding: null,
                forever: true
            }).then(function (response) {
                if (response.statusCode === 404) {
                    throw new Error('404');
                }

                picIndex = index;
                return response;
            }).catch(function(err) {
                // debug('Request photo error! %s %s %s %s', index, stream._channelId, previewUrl, err);

                index++;
                if (index < previewList.length) {
                    return requestPic(index);
                }

                if (requestLimit > 0) {
                    requestLimit--;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, requestTimeoutSec);
                    }).then(function() {
                        // debug("Retry %s request photo %s %s! %s", requestLimit, chatId, stream._channelId, err);
                        tryNumber++;
                        return requestPic(0);
                    });
                }

                throw 'Request photo error!';
            });
        };

        return requestPic(0).then(function (response) {
            if (tryNumber > 1 || picIndex > 0) {
                debug('Try: %s, photo index: %s send! %s %s', tryNumber, picIndex, stream._channelId, stream._videoId);
            }

            var image = new Buffer(response.body, 'binary');
            return sendPic(image);
        });
    };

    return sendingPic().catch(function(err) {
        debug('Send photo file error! %s %s %s', chatId, stream._channelId, err);

        var isKicked = _this.onSendMsgError(err, chatId);

        if (isKicked) {
            throw 'Send photo file error! Bot was kicked!';
        }

        throw 'Send photo file error!';
    });
};

/**
 * @param {Object} stream
 * @param {Object} msg
 * @param {number} msg.chatId
 * @param {number} msg.id
 */
Checker.prototype.addMsgInStream = function (stream, msg) {
    "use strict";
    var msgArray = stream.msgArray;
    if (!msgArray) {
        msgArray = stream.msgArray = [];
    }
    msgArray.push(msg);

    this.gOptions.events.emit('saveStreamList');
};

Checker.prototype.getMsgFromStream = function (stream) {
    "use strict";
    return stream.msgArray || [];
};

Checker.prototype.removeMsgFromStream = function (stream, msg) {
    "use strict";
    var msgArray = this.getMsgFromStream(stream);
    var pos = msgArray.indexOf(msg);
    if (pos !== -1) {
        msgArray.splice(pos, 1);
    }

    this.gOptions.events.emit('saveStreamList');
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
        }).then(function(msg) {
            _this.addMsgInStream(stream, {
                type: 'streamText',
                chatId: chatId,
                id: msg.message_id
            });

            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(err) {
            debug('Send text msg error! %s %s %s', chatId, stream._channelId, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var sendPhoto = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function(msg) {
            _this.addMsgInStream(stream, {
                type: 'streamPhoto',
                chatId: chatId,
                id: msg.message_id
            });

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
                promiseList.push(sendPhoto(chatId, photoId));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview.length) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    var requestPicId = function() {
        if (!chatIdList.length) {
            debug('chatList is empty! %j', stream);
            return Promise.resolve();
        }

        chatId = chatIdList.shift();

        return _this.getPicId(chatId, text, stream).then(function(msg) {
            _this.addMsgInStream(stream, {
                type: 'streamPhoto',
                chatId: chatId,
                id: msg.message_id
            });

            stream._photoId = msg.photo[0].file_id;

            _this.track(chatId, stream, 'sendPhoto');
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

Checker.prototype.getStreamChatIdList = function (stream) {
    "use strict";
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

    return chatIdList;
};

Checker.prototype.updateMsg = function (msg, text, noPhotoText) {
    "use strict";
    var _this = this;
    var sendPromise = null;
    if (msg.type === 'streamPhoto') {
        sendPromise = _this.gOptions.bot.editMessageCaption(
            msg.chatId,
            text,
            {
                message_id: msg.id
            }
        );
    } else
    if (msg.type === 'streamText') {
        sendPromise = _this.gOptions.bot.editMessageText(
            msg.chatId,
            noPhotoText,
            {
                message_id: msg.id
            }
        );
    }
    return sendPromise;
};

Checker.prototype.updateNotify = function (stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);
    
    var chatIdList = this.getStreamChatIdList(stream);

    if (!chatIdList.length) {
        return Promise.resolve();
    }

    var msgArray = this.getMsgFromStream(stream).slice(0);

    var promiseArr = msgArray.map(function (msg) {
        return _this.updateMsg(msg, text, noPhotoText).then(function () {
            if (msg.type === 'streamPhoto') {
                _this.track(msg.chatId, stream, 'updatePhoto');
            } else
            if (msg.type === 'streamText') {
                _this.track(msg.chatId, stream, 'updateText');
            }
        }).catch(function (err) {
            // todo: rm msg
            // _this.removeMsgFromStream(stream, msg);
            debug('Edit msg error %s', err);
        });
    });

    return Promise.all(promiseArr);
};

Checker.prototype.notify = function(stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    var chatIdList = this.getStreamChatIdList(stream);

    if (!chatIdList.length) {
        return Promise.resolve();
    }

    return this.sendNotify(chatIdList, text, noPhotoText, stream);
};

Checker.prototype.cleanServices = function() {
    "use strict";
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var promiseList = [];

    Object.keys(serviceChannelList).forEach(function (service) {
        var currentService = services[service];
        if (!currentService) {
            debug('Service "%s" is not found!', service);
            return;
        }

        var channelList = serviceChannelList[service];

        if (currentService.clean) {
            promiseList.push(currentService.clean(channelList));
        }
    });

    return Promise.all(promiseList);
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