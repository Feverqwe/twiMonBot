/**
 * Created by Anton on 06.12.2015.
 */
var Daemon = function(options) {
    "use strict";
    this.gOptions = options;

    this.TickTackTimer = null;
    this.CleanerTimer = null;
    this.CheckerTimer = null;

    this.initTickTack();
    this.initCleaner();
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

Daemon.prototype.initTickTack = function() {
    "use strict";
    var _this = this;
    var interval = 1;

    var onTimer = function() {
        _this.gOptions.events.emit('tickTack');
    };

    _this.TickTackTimer = setInterval(function() {
        onTimer();
    }, interval * 60 * 1000);
};

Daemon.prototype.initCleaner = function() {
    "use strict";
    var _this = this;
    var interval = 60;

    var onTimer = function() {
        _this.gOptions.events.emit('clean');
    };

    _this.CleanerTimer = setInterval(function() {
        onTimer();
    }, interval * 60 * 1000);
};

Daemon.prototype.initChecker = function() {
    "use strict";
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
    "use strict";
    clearInterval(this.TickTackTimer);
    clearInterval(this.CheckerTimer);
};

module.exports = Daemon;