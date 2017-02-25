/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:checker');

var Checker = function(options) {
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error!', err);
        });
    });

    options.events.on('clean', function() {
        _this.cleanServices();
    });
};

Checker.prototype.getChannelList = function() {
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
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var promiseList = [];

    Object.keys(serviceChannelList).forEach(function (service) {
        var currentService = services[service];
        if (!currentService) {
            debug('Service %s is not found!', service);
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
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var queue = Promise.resolve();

    Object.keys(serviceChannelList).forEach(function (service) {
        var currentService = services[service];
        if (!currentService) {
            debug('Service %s is not found!', service);
            return;
        }

        var channelList = serviceChannelList[service];

        queue = queue.then(function() {
            return currentService.getStreamList(channelList).then(function(videoList) {
                _this.gOptions.events.emit('updateLiveList', service, videoList, channelList);
            });
        });

        return queue;
    });

    return queue;
};

module.exports = Checker;