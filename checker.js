/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const base = require('./base');
const debug = require('debug')('app:checker');

var Checker = function(options) {
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error!', err);
        });
    });
};

/**
 * @return {Promise.<dbChannel[][]>}
 */
Checker.prototype.getServiceChannels = function() {
    var _this = this;
    var serviceNames = Object.keys(this.gOptions.services);
    return _this.gOptions.users.getAllChannels().then(function (channels) {
        var dDblChannel = [];
        var services = {};
        channels.forEach(function (channel) {
            // todo: rm me!
            if (dDblChannel.indexOf(channel.id) !== -1) {
                debug('Dbl channels! Fix me!');
                return;
            }
            dDblChannel.push(channel.id);

            var channelArray = services[channel.service];
            if (!channelArray) {
                channelArray = services[channel.service] = [];
            }

            channelArray.push(channel);
        });

        Object.keys(services).forEach(function (serviceName) {
            if (serviceNames.indexOf(serviceName) === -1) {
                debug('Service %s is not found! %j', serviceName, services[serviceName]);
                delete services[serviceName];
            }
        });

        return services;
    });
};

Checker.prototype.updateList = function() {
    var _this = this;
    var services = _this.gOptions.services;
    return _this.getServiceChannels().then(function (serviceChannels) {
        var promiseList = Object.keys(serviceChannels).map(function (serviceName) {
            var channels = serviceChannels[serviceName];
            return services[serviceName].getStreamList(channels.slice(0)).then(function(videoList) {
                return _this.gOptions.liveController.insertStreams(videoList, channels);
            });
        });
        return Promise.all(promiseList);
    }).then(function () {
        return _this.gOptions.liveController.clean();
    });
};

module.exports = Checker;