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

Checker.prototype.updateList = function() {
    var _this = this;
    var services = _this.gOptions.services;
    return _this.getChannelList().then(function (serviceChannelIds) {
        var promiseList = Object.keys(serviceChannelIds).map(function (serviceName) {
            var channelList = serviceChannelIds[serviceName];
            return services[serviceName].getStreamList(channelList).then(function(videoList) {
                return _this.gOptions.liveController.insertStreams(videoList, channelList, serviceName);
            });
        });
        return Promise.all(promiseList);
    });
};

module.exports = Checker;