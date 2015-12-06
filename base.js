/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('node-base');
var path = require('path');
var Promise = require('bluebird');
var LocalStorage = require('node-localstorage').LocalStorage;
var localStorage = null;

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadConfig = function() {
    "use strict";
    debug('Loading config');
    return new Promise(function(resolve, reject) {
        var fs = require('fs');
        return resolve(JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'))));
    });
};

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadLanguage = function() {
    "use strict";
    debug('Loading language');
    return new Promise(function(resolve, reject) {
        var fs = require('fs');
        return resolve(JSON.parse(fs.readFileSync(path.join(__dirname, 'language.json'))));
    });
};

var Storage = function() {
    "use strict";
    debug('Init storage');

    localStorage = new LocalStorage(path.join(__dirname, './storage'));

    this.get = function(arr) {
        return new Promise(function(resolve, reject) {
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
            resolve(obj);
        });
    };
    this.set = function(obj) {
        return new Promise(function(resolve, reject) {
            for (var key in obj) {
                var value = obj[key];
                if (value === undefined) {
                    localStorage.removeItem(key);
                    continue;
                }
                localStorage.setItem(key, JSON.stringify(value));
            }

            resolve();
        });
    };
    this.remove = function(arr) {
        return new Promise(function(resolve, reject) {
            if (!Array.isArray(arr)) {
                arr = [arr];
            }

            for (var i = 0, len = arr.length; i < len; i++) {
                localStorage.removeItem(arr[i]);
            }

            resolve();
        });
    };
};

module.exports.storage = new Storage();

module.exports.markDownSanitize = function(text) {
    "use strict";
    text = text.replace(/([*_\[\]])/g, '\\$1');

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