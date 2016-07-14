/**
 * Created by Anton on 06.12.2015.
 */
var path = require('path');
var Promise = require('bluebird');
var LocalStorage = require('node-localstorage').LocalStorage;
var localStorage = null;
var debug = require('debug')('base');

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadConfig = function() {
    "use strict";
    return Promise.resolve().then(function() {
        var fs = require('fs');
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    });
};

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadLanguage = function() {
    "use strict";
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

var Storage = function() {
    "use strict";
    localStorage = new LocalStorage(path.join(__dirname, './storage'));

    this.get = function(arr) {
        return Promise.resolve().then(function() {
            var key, obj = {};
            if (!Array.isArray(arr)) {
                arr = [arr];
            }
            for (var i = 0, len = arr.length; i < len; i++) {
                key = arr[i];
                var value = localStorage.getItem(key);
                if (value) {
                    obj[key] = JSON.parse(value);
                }
            }
            return obj;
        });
    };
    this.set = function(obj) {
        return Promise.resolve().then(function() {
            for (var key in obj) {
                var value = obj[key];
                if (value === undefined) {
                    localStorage.removeItem(key);
                    continue;
                }
                localStorage.setItem(key, JSON.stringify(value));
            }
        });
    };
    this.remove = function(arr) {
        return Promise.resolve().then(function() {
            if (!Array.isArray(arr)) {
                arr = [arr];
            }

            for (var i = 0, len = arr.length; i < len; i++) {
                localStorage.removeItem(arr[i]);
            }
        });
    };
};

module.exports.storage = new Storage();

/**
 * @param {string} type
 * @param {string} [text]
 * @param {string} [url]
 */
module.exports.htmlSanitize = function (type, text, url) {
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

    throw "htmlSanitize error! Type: " + type + " is not found!"
};

module.exports.markDownSanitize = function(text, char) {
    "use strict";
    if (char === '*') {
        text = text.replace(/\*/g, String.fromCharCode(735));
    }
    if (char === '_') {
        text = text.replace(/_/g, String.fromCharCode(717));
    }
    if (char === '[') {
        text = text.replace(/\[/g, '(');
        text = text.replace(/\]/g, ')');
    }
    if (!char) {
        text = text.replace(/([*_\[])/g, '\\$1');
    }

    return text;
};

module.exports.getDate = function() {
    "use strict";
    var today = new Date();
    var h = today.getHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    if (h < 10) {
        h = '0' + h;
    }
    if (m < 10) {
        m = '0' + m;
    }
    if (s < 10) {
        s = '0' + s;
    }
    return today.getDate() + "/"
        + (today.getMonth()+1)  + "/"
        + today.getFullYear() + " @ "
        + h + ":"
        + m + ":"
        + s;
};

var getTimeoutIcon = function () {
    return '⏲';
};

var getOfflineIcon = function () {
    return '🏁';
};

module.exports.getNowStreamPhotoText = function(gOptions, stream) {
    "use strict";
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
            var url = stream.channel.url;
            if (stream._isOffline && stream._recordUrl) {
                url = stream._recordUrl;
            }
            textArr.push(url);
        }

        return textArr.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};



module.exports.getNowStreamText = function(gOptions, stream) {
    "use strict";
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
        var url = stream.channel.url;
        if (stream._isOffline && stream._recordUrl) {
            url = stream._recordUrl;
        }
        var channelName = this.htmlSanitize('b', stream.channel.display_name || stream.channel.name);
        var channelUrl = this.htmlSanitize('a', gOptions.serviceToTitle[stream._service], url);
        line.push(gOptions.language.watchOn
            .replace('{channelName}', channelName)
            .replace('{serviceName}', channelUrl)
        );
    }

    var previewUrl = stream.preview[0];
    if (previewUrl) {
        line.push(this.htmlSanitize('a', gOptions.language.preview, previewUrl));
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
module.exports.getStreamText = function(gOptions, stream) {
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
        var url = stream.channel.url;
        if (stream._isOffline && stream._recordUrl) {
            url = stream._recordUrl;
        }
        var channelUrl = this.htmlSanitize('a', gOptions.serviceToTitle[stream._service], url);
        line.push(gOptions.language.watchOn
            .replace('{channelName} ', '')
            .replace('{serviceName}', channelUrl)
        );
    }

    var previewUrl = stream.preview[0];
    if (previewUrl) {
        line.push(this.htmlSanitize('a', gOptions.language.preview, previewUrl));
    }

    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
};

module.exports.extend = function() {
    "use strict";
    var obj = arguments[0];
    for (var i = 1, len = arguments.length; i < len; i++) {
        var item = arguments[i];
        for (var key in item) {
            obj[key] = item[key];
        }
    }
    return obj;
};

module.exports.getChannelTitle = function(gOptions, service, channelName) {
    "use strict";
    var title = channelName;

    var services = gOptions.services;
    if (services[service].getChannelTitle) {
        title = services[service].getChannelTitle(channelName);
    }

    return title;
};

module.exports.getChannelUrl = function(service, channelName) {
    "use strict";
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
 * @param {number} callPerSecond
 * @constructor
 */
module.exports.Quote = function (callPerSecond) {
    "use strict";
    var getTime = function() {
        return parseInt(Date.now() / 1000);
    };

    var sendTime = {};
    var cbQuote = [];

    var next = function () {
        var promiseList = cbQuote.slice(0, callPerSecond).map(function(item, index) {
            cbQuote[index] = null;
            return Promise.try(function() {
                var cb = item[0];
                var args = item[1];
                var resolve = item[2];
                var reject = item[3];

                return Promise.try(function() {
                    return cb.apply(null, args);
                }).then(resolve).catch(reject);
            });
        });

        var count = promiseList.length;

        var now = getTime();
        if (!sendTime[now]) {
            for (var key in sendTime) {
                delete sendTime[key];
            }
            sendTime[now] = 0;
        }
        sendTime[now] += count;

        return Promise.all(promiseList).then(function() {
            var now = getTime();
            if (!sendTime[now] || sendTime[now] < callPerSecond) {
                return;
            }

            return new Promise(function(resolve) {
                return setTimeout(resolve, 1000);
            });
        }).then(function() {
            cbQuote.splice(0, count);
            if (cbQuote.length) {
                next();
            }
        });
    };

    /**
     * @param {Function} cb
     * @returns {Function}
     */
    this.wrapper = function(cb) {
        return function () {
            var args = [].slice.call(arguments);

            return new Promise(function(resolve, reject) {
                cbQuote.push([cb, args, resolve, reject]);

                if (cbQuote.length > 1) {
                    return;
                }

                next();
            });
        };
    };
};

module.exports.getRandomInt = function (min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
};

module.exports.arrToParts = function (arr, quote) {
    arr = arr.slice(0);

    var arrList = [];
    do {
        arrList.push(arr.splice(0, quote));
    } while (arr.length);

    return arrList;
};

module.exports.getTimeoutStream = function (service, channelId) {
    var item = {
        _service: service,
        _channelId: channelId,
        _isTimeout: true
    };
    return item;
};

var getNow = module.exports.getNow = function () {
    return parseInt(Date.now() / 1000);
};

module.exports.throttle = function(fn, threshhold, scope) {
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
 * @returns {Array} obj[key]
 */
module.exports.getObjectItemOrArray = function (obj, key) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = [];
    }
    return item;
};

/**
 * @param {Object} obj
 * @param {*} key
 * @returns {Object} obj[key]
 */
module.exports.getObjectItemOrObj = function (obj, key) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = {};
    }
    return item;
};

/**
 * @param {Array} arr
 * @param {*} item
 */
module.exports.removeItemFromArray = function (arr, item) {
    var pos = arr.indexOf(item);
    if (pos !== -1) {
        arr.splice(pos, 1);
    }
};

module.exports.dDblUpdates = function (updates) {
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
            var lines = _this.getObjectItemOrArray(map, key);
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

module.exports.pageBtnList = function (btnList, updCommand, page, mediumBtn) {
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
                callback_data: '/' + updCommand + ' ' + (page - 1)
            });
        }
        if (mediumBtn) {
            pageControls.push.apply(pageControls, mediumBtn);
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: '/' + updCommand + ' ' + (page + 1)
            });
        }
        pageList.push(pageControls);
    } else
    if (mediumBtn) {
        pageList.push(mediumBtn);
    }
    return pageList;
};