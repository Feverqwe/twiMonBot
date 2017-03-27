"use strict";
var debug = require('debug')('app:liveController');
var debugLog = require('debug')('app:liveController:log');
debugLog.log = console.log.bind(console);
var base = require('./base');

var LiveController = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.config.liveList = this.gOptions.storage.lastStreamList;

    this.saveStreamListThrottle = base.throttle(this.saveStreamList, 250, this);

    options.events.on('updateLiveList', function(service, videoList, channelList) {
        _this.update(service, videoList, channelList);
    });

    options.events.on('saveStreamList', function () {
        _this.saveStreamListThrottle();
    });
};

var insertPool = new base.Pool(15);

LiveController.prototype.insertStreams = function (streams, channelList, serviceName) {
    var _this = this;
    return _this.gOptions.msgStack.getStreams(channelList, serviceName).then(function (currentStreams) {
        var idStreamMap = {};
        var channelIdStreams = {};
        var currentStreamIds = [];
        currentStreams.forEach(function (stream) {
            currentStreamIds.push(stream.id);
            idStreamMap[stream.id] = stream;
            var channelStreams = channelIdStreams[stream.channelId];
            if (!channelStreams) {
                channelStreams = channelIdStreams[stream.channelId] = [];
            }
            channelStreams.push(stream);
        });

        var newStreams = [];
        var updateStreams = [];
        var offlineStreams = [];
        var timeoutStreams = [];
        var syncStreams = [];
        streams.forEach(function (stream) {
            if (stream.isTimeout) {
                var streams = channelIdStreams[stream.channelId] || [];
                streams.forEach(function (stream) {
                    var pos = currentStreamIds.indexOf(stream.id);
                    if (pos !== -1) {
                        currentStreamIds.splice(pos, 1);
                    }

                    if (!stream.isTimeout) {
                        stream.isTimeout = 1;
                        stream.checkTime = base.getNow();
                        timeoutStreams.push(stream);
                    } else {
                        syncStreams.push(stream);
                    }
                });
            } else {
                var pos = currentStreamIds.indexOf(stream.id);
                if (pos !== -1) {
                    currentStreamIds.splice(pos, 1);

                    updateStreams.push(stream);
                } else {
                    newStreams.push(stream);
                }
            }
        });
        currentStreamIds.forEach(function (id) {
            var stream = idStreamMap[id];
            if (!stream.isOffline) {
                stream.isOffline = 1;
                stream.checkTime = base.getNow();
                offlineStreams.push(stream);
            } else {
                stream.checkTime = base.getNow();
                syncStreams.push(stream);
            }
        });

        var queue = Promise.resolve();
        queue = queue.then(function () {
            return insertPool.do(function () {
                var stream = newStreams.shift();
                if (!stream) return;

                return _this.gOptions.users.getChatIdsByChannel(stream.service, stream.channelId).then(function (chatIds) {
                    return _this.gOptions.msgStack.setStream(stream).then(function () {
                        return _this.gOptions.msgStack.addChatIdsStreamId(chatIds, stream.id);
                    });
                }).catch(function (err) {
                    debug('newStreams', err);
                });
            });
        });
        queue = queue.then(function () {
            return insertPool.do(function () {
                var stream = updateStreams.shift();
                if (!stream) return;

                return _this.gOptions.msgStack.getStreamLiveMessages(stream.id).then(function (message) {
                    return _this.gOptions.msgStack.setStream(stream).then(function () {
                        return _this.gOptions.msgStack.updateChatIdsStreamId(message, stream.id);
                    });
                }).catch(function (err) {
                    debug('updateStreams', err);
                });
            });
        });
        queue = queue.then(function () {
            return insertPool.do(function () {
                var stream = offlineStreams.shift();
                if (!stream) return;

                return _this.gOptions.msgStack.getStreamLiveMessages(stream.id).then(function (message) {
                    return _this.gOptions.msgStack.setStream(stream).then(function () {
                        return _this.gOptions.msgStack.updateChatIdsStreamId(message, stream.id);
                    });
                }).catch(function (err) {
                    debug('offlineStreams', err);
                });
            });
        });
        queue = queue.then(function () {
            return insertPool.do(function () {
                var stream = timeoutStreams.shift();
                if (!stream) return;

                return _this.gOptions.msgStack.getStreamLiveMessages(stream.id).then(function (message) {
                    return _this.gOptions.msgStack.setStream(stream).then(function () {
                        return _this.gOptions.msgStack.updateChatIdsStreamId(message, stream.id);
                    });
                }).catch(function (err) {
                    debug('timeoutStreams', err);
                });
            });
        });
        queue = queue.then(function () {
            return insertPool.do(function () {
                var stream = syncStreams.shift();
                if (!stream) return;

                return _this.gOptions.msgStack.setStream(stream).catch(function (err) {
                    debug('syncStreams', err);
                });
            });
        });
        return queue;
    });
};

LiveController.prototype.saveStreamList = function () {
    return base.storage.set({
        lastStreamList: this.config.liveList
    });
};

LiveController.prototype.prepLiveListCache = function (service, liveList) {
    var streamIdList = {};
    var channelsStreamList = {};
    liveList.forEach(function (item) {
        if (item._service !== service) {
            return;
        }
        streamIdList[item._id] = item;
        var channelStreamList = channelsStreamList[item._channelId];
        if (!channelStreamList) {
            channelStreamList = channelsStreamList[item._channelId] = [];
        }
        channelStreamList.push(item);
    });
    return {
        streamIdList: streamIdList,
        channelsStreamList: channelsStreamList
    };
};

LiveController.prototype.updateObj = function (oldObj, newObj) {
    var _this = this;
    var diff = [];
    var keys = Object.keys(newObj);
    keys.forEach(function (key) {
        var oldValue = oldObj[key];
        var value = newObj[key];

        if (typeof value === 'object' && value && oldValue) {
            if (Array.isArray(value)) {
                if (JSON.stringify(value) !== JSON.stringify(oldValue)) {
                    diff.push(key);
                    oldObj[key] = value;
                }
            } else {
                diff.push.apply(diff, _this.updateObj(oldValue, value));
            }
        } else
        if (oldValue !== value) {
            diff.push(key);
            oldObj[key] = value;
        }
    });
    return diff;
};

LiveController.prototype.findDblStream = function (oldStreamList, newItem) {
    var id = null;
    oldStreamList.some(function (item) {
       if (
           item.channel.status === newItem.channel.status &&
           item.channel.game === newItem.channel.game) {
           id = item._id;
           return true;
       }
    });
    return id;
};

LiveController.prototype.update = function (service, newLiveList, channelList) {
    var _this = this;

    var timeout = this.gOptions.config.timeout;

    var liveList = this.config.liveList;
    var now = base.getNow();

    var cache = this.prepLiveListCache(service, liveList);
    var lastStreamIdObj = cache.streamIdList;
    var lastChannelStreamObj = cache.channelsStreamList;

    var removeItemFromLiveList = function (item) {
        var pos = liveList.indexOf(item);
        if (pos !== -1) {
            liveList.splice(pos, 1);
        }
    };

    var logStream = function (_stream) {
        var stream = JSON.parse(JSON.stringify(_stream));
        delete stream.preview;
        return stream;
    };

    newLiveList.forEach(function (item) {
        var channelStreamList = null;
        if (item._isTimeout) {
            channelStreamList = lastChannelStreamObj[item._channelId];
            channelStreamList && channelStreamList.forEach(function (oldItem) {
                // stream exists, update info
                delete lastStreamIdObj[oldItem._id];
                // set timeout status
                if (!oldItem._isTimeout) {
                    oldItem._isTimeout = true;

                    debugLog('Timeout (U) %s %j', oldItem._channelId, logStream(oldItem));
                    _this.gOptions.events.emit('updateNotify', oldItem);
                }
            });
            return;
        }

        var changes = null;
        var id = item._id;
        var oldItem = lastStreamIdObj[id];
        if (oldItem) {
            // stream exists, update info
            delete lastStreamIdObj[id];
            // don't inherit insert time
            delete item._insertTime;
            // rm photo cache
            delete oldItem._photoId;
            
            changes = _this.updateObj(oldItem, item);

            if (changes.indexOf('_isOffline') !== -1 || changes.indexOf('_isTimeout') !== -1) {
                debugLog('Online (U) %s %j', oldItem._channelId, logStream(oldItem));
                _this.gOptions.events.emit('updateNotify', oldItem);
            } else
            if (changes.indexOf('game') !== -1 || changes.indexOf('status') !== -1) {
                // notify when status of game change
                debugLog('Changes (U) %s %j', oldItem._channelId, logStream(oldItem));
                _this.gOptions.events.emit('updateNotify', oldItem);
            }
            return;
        }

        var channelId = item._channelId;
        channelStreamList = lastChannelStreamObj[channelId];
        if (!channelStreamList) {
            // is new stream, notify
            liveList.push(item);
            debugLog('New (N) %s %j', item._channelId, logStream(item));
            item._notifyTime = now;
            _this.gOptions.events.emit('notify', item);
            return;
        }

        var dbId = _this.findDblStream(channelStreamList, item);
        oldItem = lastStreamIdObj[dbId];
        if (oldItem) {
            // stream is crash, found prev item update it
            delete lastStreamIdObj[dbId];
            // don't inherit insert time
            delete item._insertTime;
            // rm photo cache
            delete oldItem._photoId;

            changes = _this.updateObj(oldItem, item);

            if (changes.indexOf('_isOffline') !== -1 || changes.indexOf('_isTimeout') !== -1) {
                debugLog('Online dbl (U) %s %j', oldItem._channelId, logStream(oldItem));
                _this.gOptions.events.emit('updateNotify', oldItem);
            } else {
                debugLog('Dbl %s %j', oldItem._channelId, logStream(oldItem));
            }
            return;
        }

        // more one stream from channelId
        liveList.push(item);
        debugLog('Dbl (N) %s %j', item._channelId, logStream(item));
        item._notifyTime = now;
        return _this.gOptions.events.emit('notify', item);
    });

    Object.keys(lastStreamIdObj).forEach(function (key) {
        // check offline channels
        var item = lastStreamIdObj[key];
        var channelId = item._channelId;

        if (channelList.indexOf(channelId) === -1) {
            if (now - item._checkTime > 3600) {
                // if item don't check more 1h
                debugLog('Remove unused %s %j', item._channelId, logStream(item));
                removeItemFromLiveList(item);
            }
            return;
        }

        if (!item._isOffline) {
            // set offline status
            item._isOffline = true;
            item._isTimeout = false;
            item._offlineStartTime = now;
            debugLog('Offline (U) %s %j', item._channelId, logStream(item));
            _this.gOptions.events.emit('updateNotify', item);
        } else
        if (now - item._offlineStartTime > timeout) {
            // if offline status > timeout - remove item
            debugLog('Remove %s %j', item._channelId, logStream(item));
            removeItemFromLiveList(item);
        }
    });

    return this.saveStreamList();
};

module.exports = LiveController;