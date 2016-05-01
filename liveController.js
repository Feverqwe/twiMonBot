var debug = require('debug')('liveController');
var debugLog = require('debug')('liveController:log');
debugLog.log = console.log.bind(console);
var base = require('./base');
var Promise = require('bluebird');

var LiveController = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.config.liveList = this.gOptions.storage.lastStreamList;

    // todo: rm me!
    this.config.liveList.forEach(function (item) {
        if (!item.channelId && item._channelName) {
            item.channelId = item._channelName;
        }
        if (!item._insertTime && item._createTime) {
            item._insertTime = item._createTime;
        }
        if (!item._checkTime && item._addItemTime) {
            item._checkTime = item._addItemTime;
        }
        if (!/^[thgy]/.test(item._id)) {
            item._id = item.channelId[0] + item._id;
        }
    });

    options.events.on('updateLiveList', function(service, videoList, channelList) {
        _this.update(service, videoList, channelList);
    });
};

LiveController.prototype.saveStreamList = function () {
    return base.storage.set({
        lastStreamList: this.config.liveList
    });
};

LiveController.prototype.prepLiveListCache = function (liveList) {
    var streamIdList = {};
    var channelsStreamList = {};
    liveList.forEach(function (item) {
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

        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                if (JSON.stringify(value) !== JSON.stringify(oldValue)) {
                    diff.push(key);
                    oldObj[key] = value;
                }
            } else
            if (value && oldValue) {
                return diff.push.apply(diff, _this.updateObj(oldValue, value));
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

    // todo fix me!
    var notifyTimeout = null;
    if (this.gOptions.config.notifyTimeoutMin) {
        notifyTimeout = this.gOptions.config.notifyTimeoutMin * 60;
    } else {
        notifyTimeout = this.gOptions.config.notifyTimeout * 60;
    }

    var liveList = this.config.liveList;
    var now = base.getNow();

    var cache = this.prepLiveListCache(liveList);
    var lastStreamIdObj = cache.streamIdList;
    var lastChannelStreamObj = cache.channelsStreamList;

    var removeItemFromLiveList = function (item) {
        var pos = liveList.indexOf(item);
        if (pos !== -1) {
            liveList.splice(pos, 1);
        }
    };

    newLiveList.forEach(function (item) {
        var id = item._id;
        var oldItem = lastStreamIdObj[id];
        if (oldItem) {
            // stream exists, update info
            delete lastStreamIdObj[id];
            // rm photo cache
            delete oldItem._photoId;
            var changes = _this.updateObj(oldItem, item);
            if (changes.indexOf('game') !== -1 || changes.indexOf('status') !== -1) {
                // notify when status of game change
                if (now - item._notifyTime > notifyTimeout) {
                    debugLog('Notify changes %j', item);
                    item._notifyTime = now;
                    _this.gOptions.events.emit('notify', item);
                }
            }
            return;
        }

        var channelId = item._channelId;
        var channelStreamList = lastChannelStreamObj[channelId];
        if (!channelStreamList) {
            // is new stream, notify
            liveList.push(item);
            debugLog('Notify new %j', item);
            item._notifyTime = now;
            return _this.gOptions.events.emit('notify', item);
        }

        var dbId = _this.findDblStream(channelStreamList, item);
        oldItem = lastStreamIdObj[dbId];
        if (oldItem) {
            // stream is crash, found prev item update it
            delete lastStreamIdObj[dbId];
            // rm photo cache
            delete oldItem._photoId;
            _this.updateObj(oldItem, item);
            // inherit insert time from old item
            item._insertTime = oldItem._insertTime;
            debugLog('Dbl %j', item);
            return;
        }

        // more one stream from channelId
        liveList.push(item);
        debugLog('Notify dbl %j', item);
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
                debugLog('Remove unused item %j', item);
                removeItemFromLiveList(item);
            }
            return;
        }

        if (!item._isOffline) {
            // set offline status
            item._isOffline = true;
            item._offlineStartTime = now;
            debugLog('Offline  %j', item);
        } else
        if (now - item._offlineStartTime > timeout) {
            // if offline status > timeout - remove item
            debugLog('Remove  %j', item);
            removeItemFromLiveList(item);
        }
    });

    return this.saveStreamList();
};

module.exports = LiveController;