/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const fs = require('fs');
const path = require('path');
const debug = require('debug')('app:base');
var Storage = require('./storage');

var utils = {};

/**
 *
 * @returns {Promise}
 */
utils.loadConfig = function() {
    return Promise.resolve().then(function() {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    });
};

/**
 *
 * @returns {Promise}
 */
utils.loadLanguage = function() {
    return Promise.resolve().then(function() {
        var fs = require('fs');

        var language = JSON.parse(fs.readFileSync(path.join(__dirname, 'language.json')));

        for (var key in language) {
            var item = language[key];
            if (Array.isArray(item)) {
                item = item.join('\n');
            }
            language[key] = item;
        }

        return language;
    });
};

utils.storage = new Storage();

/**
 * @param {string} type
 * @param {string} [text]
 * @param {string} [url]
 */
utils.htmlSanitize = function (type, text, url) {
    if (!text) {
        text = type;
        type = '';
    }

    var sanitize = function (text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    var sanitizeAttr = function (text) {
        return sanitize(text).replace(/"/g, '&quot;');
    };

    switch (type) {
        case '':
            return sanitize(text);
        case 'a':
            return '<a href="'+sanitizeAttr(url)+'">'+sanitize(text)+'</a>';
        case 'b':
            return '<b>'+sanitize(text)+'</b>';
        case 'strong':
            return '<strong>'+sanitize(text)+'</strong>';
        case 'i':
            return '<i>'+sanitize(text)+'</i>';
        case 'em':
            return '<em>'+sanitize(text)+'</em>';
        case 'pre':
            return '<pre>'+sanitize(text)+'</pre>';
        case 'code':
            return '<code>'+sanitize(text)+'</code>';
    }

    debug("htmlSanitize error, type: " + type + " is not found!");
    throw new Error("htmlSanitize error");
};

var getTimeoutIcon = function () {
    return '⏲';
};

var getOfflineIcon = function () {
    return '🏁';
};

utils.getNowStreamPhotoText = function(gOptions, stream) {
    var getText = function (stripLen) {
        var textArr = [];

        var status = '';

        var line = [];
        if (stream._isTimeout) {
            line.push(getTimeoutIcon());
        } else
        if (stream._isOffline) {
            line.push(getOfflineIcon());
        }

        var descPart = [];
        if (stream.channel.status) {
            descPart.push(status = stream.channel.status);
        }
        if (stream.game && status.indexOf(stream.game) === -1) {
            descPart.push(stream.game);
        }
        if (descPart.length) {
            var desc = descPart.join(', ');
            if (stripLen) {
                desc = desc.substr(0, desc.length - stripLen - 3) + '...';
            }
            line.push(desc);
        }

        if (line.length) {
            textArr.push(line.join(', '));
        }

        if (stream.channel.url) {
            textArr.push(stream.channel.url);
        }

        return textArr.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};

utils.getNowStreamText = function(gOptions, stream) {
    var textArr = [];

    var status = '';

    var line = [];
    if (stream._isTimeout) {
        line.push(getTimeoutIcon());
    } else
    if (stream._isOffline) {
        line.push(getOfflineIcon());
    }

    if (stream.channel.status) {
        line.push(this.htmlSanitize(status = stream.channel.status));
    }
    if (stream.game && status.indexOf(stream.game) === -1) {
        line.push(this.htmlSanitize('i', stream.game));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (stream.channel.url) {
        var channelName = this.htmlSanitize('b', stream.channel.display_name || stream.channel.name);
        line.push(channelName);
        line.push(stream.channel.url);
    }

    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
};

/**
 *
 * @param gOptions
 * @param {Object} stream
 * @param {number} stream.viewers
 * @param {string} stream.game
 * @param {string} stream._id
 * @param {string} stream._service
 * @param {string} stream._channelId
 * @param {Array} stream.preview
 * @param {boolean} stream._isOffline
 * @param {boolean} stream._isTimeout
 * @param {Object} stream.channel
 * @param {string} stream.channel.display_name
 * @returns {string}
 */
utils.getStreamText = function(gOptions, stream) {
    var textArr = [];

    textArr.push(this.htmlSanitize('b', stream.channel.display_name || stream.channel.name));

    var status = '';

    var line = [];
    if (stream._isTimeout) {
        line.push(getTimeoutIcon());
    } else
    if (stream._isOffline) {
        line.push(getOfflineIcon());
    } else
    if (stream.viewers || stream.viewers === 0) {
        line.push(stream.viewers);
    }
    if (stream.channel.status) {
        line.push(this.htmlSanitize(status = stream.channel.status));
    }
    if (stream.game && status.indexOf(stream.game) === -1) {
        line.push(this.htmlSanitize('i', stream.game));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (stream.channel.url) {
        line.push(stream.channel.url);
    }

    var url = stream.preview[0];
    if (url) {
        line.push(this.htmlSanitize('a', gOptions.language.preview, url));
    }

    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
};

utils.extend = function() {
    var obj = arguments[0];
    for (var i = 1, len = arguments.length; i < len; i++) {
        var item = arguments[i];
        for (var key in item) {
            obj[key] = item[key];
        }
    }
    return obj;
};

/**
 * @param gOptions
 * @param service
 * @param channelName
 * @return {Promise}
 */
utils.getChannelTitle = function(gOptions, service, channelName) {
    var result;

    var services = gOptions.services;
    if (services[service].getChannelTitle) {
        result = services[service].getChannelTitle(channelName);
    } else {
        result = Promise.resolve(channelName);
    }

    return result;
};

/**
 * @param {string} service
 * @param {string} channelName
 * @return {string}
 */
utils.getChannelUrl = function(service, channelName) {
    var url = '';
    if (service === 'youtube') {
        url = 'https://youtube.com/';
        if (/^UC/.test(channelName)) {
            url += 'channel/';
        } else {
            url += 'user/';
        }
        url += channelName;
    }

    if (service === 'goodgame') {
        url = 'http://goodgame.ru/channel/' + channelName;
    }

    if (service === 'twitch') {
        url = 'http://twitch.tv/' + channelName;
    }

    if (service === 'hitbox') {
        url = 'http://hitbox.tv/' + channelName;
    }

    return url;
};

/**
 * @param {number} limitPerSecond
 * @constructor
 */
utils.Quote = function (limitPerSecond) {
    var queue = [];
    var time = 0;
    var count = 0;
    var timer = null;
    var next = function () {
        if (timer !== null) return;

        var now = Date.now();
        if (now - time >= 1000) {
            time = now;
            count = 0;
        }

        while (queue.length && count < limitPerSecond) {
            count++;
            queue.shift()();
        }

        if (count === limitPerSecond) {
            timer = setTimeout(function () {
                timer = null;
                next();
            }, 1000 - (Date.now() - time));
        }
    };

    /**
     * @param {Function} callback
     * @param {Object} [thisArg]
     * @returns {Function}
     */
    this.wrapper = function(callback, thisArg) {
        return function () {
            var args = [].slice.call(arguments);

            return new Promise(function (resolve, reject) {
                queue.push(function () {
                    try {
                        resolve(callback.apply(thisArg, args));
                    } catch (err) {
                        reject(err);
                    }
                });
                next();
            });
        };
    };
};

utils.getRandomInt = function (min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
};

utils.arrToParts = function (arr, quote) {
    arr = arr.slice(0);

    if (isNaN(quote)) {
        return arr;
    }

    var arrList = [];
    do {
        arrList.push(arr.splice(0, quote));
    } while (arr.length);

    return arrList;
};

utils.getTimeoutStream = function (service, channelId) {
    var item = {
        _service: service,
        _channelId: channelId,
        _isTimeout: true
    };
    return item;
};

utils.getNow = function () {
    return parseInt(Date.now() / 1000);
};

utils.throttle = function(fn, threshhold, scope) {
    threshhold = threshhold || 250;
    var last;
    var deferTimer;
    return function () {
        var context = scope || this;

        var now = Date.now();
        var args = arguments;
        if (last && now < last + threshhold) {
            // hold on to it
            clearTimeout(deferTimer);
            deferTimer = setTimeout(function () {
                last = now;
                fn.apply(context, args);
            }, threshhold);
        } else {
            last = now;
            fn.apply(context, args);
        }
    };
};

/**
 * @param {Object} obj
 * @param {*} key
 * @param {*} defaultValue
 * @returns {*}
 */
utils.getObjectItem = function (obj, key, defaultValue) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = defaultValue;
    }
    return item;
};

/**
 * @param {Array} arr
 * @param {*} item
 */
utils.removeItemFromArray = function (arr, item) {
    var pos = arr.indexOf(item);
    if (pos !== -1) {
        arr.splice(pos, 1);
    }
};

utils.dDblUpdates = function (updates) {
    var _this = this;
    var dDblUpdates = updates.slice(0);
    var map = {};
    updates.reverse().forEach(function (update) {
        var message = update.message;
        var callbackQuery = update.callback_query;
        var key = null;
        var value = null;
        if (message) {
            key = JSON.stringify(message.from) + JSON.stringify(message.chat);
            value = message.text;
        } else
        if (callbackQuery) {
            key = JSON.stringify(callbackQuery.message.chat) + callbackQuery.message.message_id;
            value = callbackQuery.data;
        }
        if (key && value) {
            var lines = _this.getObjectItem(map, key, []);
            if (lines[0] === value) {
                _this.removeItemFromArray(dDblUpdates, update);
                debug('Skip dbl msg %j', update);
            } else {
                lines.unshift(value);
            }
        }
    });
    return dDblUpdates;
};

utils.pageBtnList = function (btnList, command, page, mediumBtn) {
    page = parseInt(page || 0);
    if (mediumBtn && !Array.isArray(mediumBtn)) {
        mediumBtn = [mediumBtn];
    }
    var maxItemCount = 10;
    var offset = page * maxItemCount;
    var offsetEnd = offset + maxItemCount;
    var countItem = btnList.length;
    var pageList = btnList.slice(offset, offsetEnd);
    if (countItem > maxItemCount || page > 0) {
        var pageControls = [];
        if (page > 0) {
            pageControls.push({
                text: '<',
                callback_data: command + '?page=' + (page - 1)
            });
        }
        if (mediumBtn) {
            pageControls.push.apply(pageControls, mediumBtn);
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: command + '?page=' + (page + 1)
            });
        }
        pageList.push(pageControls);
    } else
    if (mediumBtn) {
        pageList.push(mediumBtn);
    }
    return pageList;
};

var sepRe = /\?/;
utils.noCacheUrl = function (url) {
    var sep = sepRe.test(url) ? '&' : '?';
    return url + sep + '_=' + utils.getNow();
};

utils.arrayToChainPromise = function (arr, callbackPromise) {
    var next = function () {
        var result = null;
        var item = arr.shift();
        if (item) {
            result = callbackPromise(item).then(next);
        } else {
            result = Promise.resolve();
        }
        return result;
    };
    return next();
};

utils.Pool = function (limit) {
    var queuePush = [];
    var activeCountPush = 0;
    var end = function (cb) {
        return function (result) {
            activeCountPush--;
            nextPush();
            return cb(result);
        };
    };
    var nextPush = function () {
        var item;
        while (queuePush.length && activeCountPush < limit) {
            item = queuePush.shift();
            activeCountPush++;
            item[0]().then(end(item[1]), end(item[2]));
        }
    };
    this.push = function (callbackPromise) {
        return new Promise(function (resolve, reject) {
            queuePush.push([callbackPromise, resolve, reject]);
            nextPush();
        });
    };

    var waitArr = [];
    var activeCountDo = 0;
    var getPromiseFnArr = [];
    var rejectAll = function (err) {
        getPromiseFnArr.splice(0);
        activeCountDo = 0;

        var item;
        while (item = waitArr.shift()) {
            item[1](err);
        }
    };
    var resolveAll = function () {
        var item;
        while (item = waitArr.shift()) {
            item[0]();
        }
    };
    var runPromise = function () {
        if (!getPromiseFnArr.length) return;

        var promise = getPromiseFnArr[0]();
        if (!promise) {
            getPromiseFnArr.shift();
            return runPromise();
        } else {
            activeCountDo++;
            return promise.then(function () {
                activeCountDo--;
                nextDo();
            }, rejectAll);
        }
    };
    var nextDo = function () {
        while (activeCountDo < limit) {
            if (!runPromise()) {
                break;
            }
        }
        if (!activeCountDo) {
            resolveAll();
        }
    };
    this.do = function (getPromiseFn) {
        return new Promise(function (resolve, reject) {
            getPromiseFnArr.push(getPromiseFn);
            waitArr.push([resolve, reject]);
            nextDo();
        });
    };
};

module.exports = utils;