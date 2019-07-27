/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var Daemon = function(options) {
    this.gOptions = options;

    this.CheckerTimer = null;

    this.initChecker();
};

Daemon.prototype.getRunTime = function(interval) {
    var everyMs = interval * 60 * 1000;
    var today = new Date();
    var ms = today.getMilliseconds();
    var sec = today.getSeconds();
    var min = today.getMinutes();
    var hours = today.getHours();

    var nowMs = hours * 60 * 60 * 1000 + min * 60 * 1000 + sec * 1000 + ms;

    var waitMs = everyMs - nowMs % everyMs;

    return waitMs;
};

Daemon.prototype.initChecker = function() {
    var _this = this;
    var interval = _this.gOptions.config.interval;

    var onTimer = function() {
        _this.gOptions.events.emit('check');
    };

    setTimeout(function() {
        _this.CheckerTimer = setInterval(function() {
            onTimer();
        }, interval * 60 * 1000);

        onTimer();
    }, _this.getRunTime(interval));

    if (this.gOptions.config.checkOnRun) {
        setTimeout(function () {
            onTimer();
        }, 1000);
    }
};

Daemon.prototype.abort = function() {
    clearInterval(this.CheckerTimer);
};

module.exports = Daemon;