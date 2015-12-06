/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('daemon');
var Daemon = function(options) {
    "use strict";
    this.gOptions = options;

    this.TickTackTimer = null;
    this.CheckerTimer = null;

    this.initTickTack();
    this.initChecker();
};

Daemon.prototype.getRunTime = function(interval) {
    var everyMs = interval * 60 * 1000;
    var today = new Date();
    var ms = today.getMilliseconds();
    var sec = today.getSeconds();
    var min = today.getMinutes();

    var nowMs = min * 60 * 1000 + sec * 1000 + ms;

    var waitMs = everyMs - nowMs % everyMs;

    return waitMs;
};

Daemon.prototype.initTickTack = function() {
    "use strict";
    var _this = this;
    var interval = 1;

    var onTimer = function() {
        debug('tickTack');
        _this.gOptions.events.emit('tickTack');
    };

    setTimeout(function() {
        _this.TickTackTimer = setInterval(function() {
            onTimer();
        }, interval * 60 * 1000);

        onTimer();
    }, _this.getRunTime(interval));
};

Daemon.prototype.initChecker = function() {
    "use strict";
    var _this = this;
    var interval = _this.gOptions.config.interval;

    var onTimer = function() {
        debug('check');
        _this.gOptions.events.emit('check');
    };

    setTimeout(function() {
        _this.CheckerTimer = setInterval(function() {
            onTimer();
        }, interval * 60 * 1000);

        onTimer();
    }, _this.getRunTime(interval));
};

Daemon.prototype.abort = function() {
    "use strict";
    clearInterval(this.TickTackTimer);
    clearInterval(this.CheckerTimer);
};

module.exports = Daemon;