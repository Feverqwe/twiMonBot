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
    var _this = this;
    var serviceNames = Object.keys(this.gOptions.services);
    return _this.gOptions.users.getAllChannels().then(function (channels) {
        var serviceList = {};
        channels.forEach(function (item) {
            var channelList = serviceList[item.service];
            if (!channelList) {
                channelList = serviceList[item.service] = [];
            }
            channelList.push(item.channelId);
        });

        Object.keys(serviceList).forEach(function (serviceName) {
            if (serviceNames.indexOf(serviceName) === -1) {
                debug('Service %s is not found! %j', serviceName, serviceList[serviceName]);
                delete serviceList[serviceName];
            }
        });

        return serviceList;
    });
};

Checker.prototype.cleanServices = function() {
    // todo: fix me
    return Promise.resolve();

    /*var _this = this;
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

    return Promise.all(promiseList);*/
};

Checker.prototype.updateList = function() {
    var _this = this;
    var services = _this.gOptions.services;
    return _this.getChannelList().then(function (serviceChannelIds) {
        var promiseList = Object.keys(serviceChannelIds).map(function (serviceName) {
            var channelList = serviceChannelIds[serviceName];
            return services[serviceName].getStreamList(channelList).then(function(videoList) {
                _this.gOptions.events.emit('updateLiveList', serviceName, videoList, channelList);
            });
        });
        return Promise.all(promiseList);
    });
};

module.exports = Checker;