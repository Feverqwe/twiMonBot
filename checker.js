/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error! "%s"', err);
        });
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

module.exports = Checker;