/**
 * Created by anton on 31.01.16.
 */
"use strict";
var debug = require('debug')('app:tracker');
var request = require('request');
var Uuid = require('uuid');
var requestPromise = require('request-promise');

var Tracker = function(options) {
    this.gOptions = options;
    this.tid = options.config.gaId;
    this.idCache = [];
    this.idUuidMap = {};
};

Tracker.prototype.getUuid = function(id) {
    var _this = this;
    var uuid = this.idUuidMap[id];
    if (uuid) {
        return uuid;
    }

    var arr = [];
    for (var i = 0; i < 16; i++) {
        arr[i] = 0x0;
    }

    var vId = id;

    var prefix = 0;
    if (vId < 0) {
        prefix = 1;
        vId *= -1;
    }

    var idArr = vId.toString().split('').reverse().join('').match(/(\d{0,2})/g).reverse();

    var index = arr.length;
    var chunk;
    while (chunk = idArr.pop()) {
        index--;
        arr[index] = parseInt(prefix + chunk, 10);
    }

    uuid = Uuid.v4({
        random: arr
    });

    _this.idCache.unshift(id);
    _this.idUuidMap[id] = uuid;
    _this.idCache.splice(50).forEach(function (id) {
        delete _this.idUuidMap[id];
    });

    return uuid;
};

Tracker.prototype.track = function(msg, action) {
    return this.trackerSend(msg, action);
};

Tracker.prototype.trackerSend = function(msg, action) {
    var id = msg.chat.id;

    var params = {
        ec: 'bot',
        ea: action,
        el: msg.text,
        t: 'event',
        cid: this.getUuid(id)
    };

    return this.send(params);
};

Tracker.prototype.send = function(params) {
    if (!this.tid) {
        debug('Send in ga %j', params);
        return;
    }

    var defaultParams = {
        v: 1,
        tid: this.tid,
        an: 'bot'
    };

    for (var key in defaultParams) {
        if(!params.hasOwnProperty(key)) {
            params[key] = defaultParams[key];
        }
    }

    var limit = 5;
    var send = function () {
        return requestPromise({
            url: 'https://www.google-analytics.com/collect',
            method: 'POST',
            form: params,
            gzip: true,
            forever: true
        }).catch(function (err) {
            if (limit-- < 1) {
                debug('Track error %s %s %s', err.name, err.statusCode, err.message);
            } else {
                return new Promise(function (resolve) {
                    setTimeout(resolve, 250);
                }).then(function () {
                    return send();
                });
            }
        });
    };
    return send();
};

module.exports = Tracker;