/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const fs = require('fs');
const path = require('path');
const debug = require('debug')('app:base');

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

var getOnlineIcon = function () {
    return '🎈';
};

utils.getNowStreamPhotoText = function(gOptions, stream) {
    var getText = function (stripLen) {
        var lines = [];

        var symbol = '';
        if (stream._isTimeout) {
            symbol = getTimeoutIcon();
        } else
        if (stream._isOffline) {
            symbol = getOfflineIcon();
        }

        var status = stream.channel.status || '';
        var game = stream.game || '';
        if (status.indexOf(game) !== -1) {
            game = '';
        }
        var url = stream.channel.url || '';


        var title = [];
        if (symbol) {
            title.push(symbol);
        }
        if (status) {
            title.push(status);
        }
        if (game) {
            if (status) {
                title.push('—');
            }
            title.push(game);
        }
        var statusLine = title.join(' ');


        if (statusLine) {
            if (stripLen) {
                statusLine = statusLine.substr(0, statusLine.length - stripLen - 3) + '...';
            }

            lines.push(statusLine);
        }
        if (url) {
            lines.push(url);
        }

        return lines.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};

utils.getNowStreamText = function(gOptions, stream) {
    var lines = [];

    var symbol = '';
    if (stream._isTimeout) {
        symbol = getTimeoutIcon();
    } else
    if (stream._isOffline) {
        symbol = getOfflineIcon();
    }

    var status = stream.channel.status || '';
    var game = stream.game || '';
    var name = stream.channel.name || '';
    if (status.indexOf(game) !== -1) {
        game = '';
    }
    var url = stream.channel.url || '';


    var title = [];
    if (symbol) {
        title.push(symbol);
    }
    if (status) {
        title.push(this.htmlSanitize(status));
    }
    var statusLine = title.join(' ');


    var description = [];
    if (name) {
        description.push(name);
    }
    if (game) {
        if (name) {
            description.push('—');
        }
        description.push(game);
    }
    var descLine = description.join(' ');


    if (statusLine) {
        lines.push(statusLine);
    }
    if (descLine) {
        if (url) {
            lines.push(this.htmlSanitize('a', descLine, url));
        } else {
            lines.push(this.htmlSanitize(descLine));
        }
    } else
    if (url) {
        lines.push(url);
    }

    return lines.join('\n');
};

/**
 *
 * @param gOptions
 * @param {Object} stream
 * @param {number} stream.viewers
 * @param {string} stream.game
 * @param {string} stream._id
 * @param {string} stream._channelId
 * @param {Array} stream.preview
 * @param {boolean} stream._isOffline
 * @param {boolean} stream._isTimeout
 * @param {Object} stream.channel
 * @param {string} stream.channel.name
 * @returns {string}
 */
utils.getStreamText = function(gOptions, stream) {
    var lines = [];

    var symbol = '';
    if (stream._isTimeout) {
        symbol = getTimeoutIcon();
    } else
    if (stream._isOffline) {
        symbol = getOfflineIcon();
    } else {
        symbol = getOnlineIcon();
    }

    var status = stream.channel.status || '';
    var viewers = stream.viewers || 0;
    var game = stream.game || '';
    var name = stream.channel.name || '';
    if (status.indexOf(game) !== -1) {
        game = '';
    }
    var url = stream.channel.url || '';


    var header = [];
    if (name) {
        header.push(this.htmlSanitize('b', name));
    }
    header.push(symbol);
    if (viewers > 0) {
        header.push(viewers);
    }
    var headerLine = header.join(' ');


    var title = [];
    if (status) {
        title.push(this.htmlSanitize(status));
    }
    if (game) {
        if (status) {
            title.push('—');
        }
        title.push(this.htmlSanitize(game));
    }
    var statusLine = title.join(' ');


    if (headerLine) {
        lines.push(headerLine);
    }
    if (statusLine) {
        lines.push(statusLine);
    }
    if (url) {
        lines.push(url);
    }

    return lines.join('\n');
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

utils.getTimeoutStream = function (channelId) {
    return {
        channelId: channelId,
        isTimeout: 1
    };
};

utils.getNow = function () {
    return parseInt(Date.now() / 1000);
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