var Promise = require("bluebird");
var request = require("request");
var requestPromise = Promise.promisify(request);

var LocalStorage = require('node-localstorage').LocalStorage;
var localStorage = new LocalStorage('./storage');

var utils = {
  storage: function() {
    "use strict";
    return {
      get: function(arr, cb) {
        "use strict";
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
        cb(obj);
      },
      set: function(obj, cb) {
        "use strict";
        for (var key in obj) {
          var value = obj[key];
          if (value === undefined) {
            localStorage.removeItem(key);
            continue;
          }
          localStorage.setItem(key, JSON.stringify(value));
        }
        cb && cb();
      },
      remove: function(arr) {
        if (!Array.isArray(arr)) {
          arr = [arr];
        }

        for (var i = 0, len = arr.length; i < len; i++) {
          localStorage.removeItem(arr[i]);
        }
      }
    }
  }(),
  param: function(params) {
    "use strict";
    if (typeof params === 'string') return params;

    var args = [];
    for (var key in params) {
      var value = params[key];
      if (value === null || value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (var n = 0, len = value.length; n < len; n++) {
          args.push(encodeURIComponent(key) + '=' + encodeURIComponent(value[n]));
        }
        continue
      }
      args.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    return args.join('&');
  },
  ajax: function(obj) {
    "use strict";
    var url = obj.url;

    var method = obj.type || 'GET';
    method.toUpperCase();

    var data = obj.data;
    if (data && typeof data !== "string") {
      data = utils.param(data);
    }

    if (data && method === 'GET') {
      url += (url.indexOf('?') === -1 ? '?' : '&') + data;
      data = undefined;
    }

    if (obj.cache === false && ['GET', 'HEAD'].indexOf(method) !== -1) {
      var nc = '_=' + Date.now();
      url += (url.indexOf('?') === -1 ? '?' : '&') + nc;
    }

    if (obj.dataType) {
      obj.dataType = obj.dataType.toLowerCase();
    }

    if (!obj.headers) {
      obj.headers = {};
    }

    if (obj.contentType) {
      obj.headers["Content-Type"] = obj.contentType;
    }

    if (data && !obj.headers["Content-Type"]) {
      obj.headers["Content-Type"] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }


    var options = {};
    options.url = url;
    options.method = method;

    if (obj.headers) {
      options.headers = obj.headers;
    }

    if (data) {
      options.body = data;
    }

    var onReady = function(resp) {
      if (!(resp[0].statusCode >= 200 && resp[0].statusCode < 300 || resp[0].statusCode === 304)) {
        throw new Error(resp[0].statusCode+' '+resp[0].body);
      }

      var data = resp[0].body;

      if (obj.dataType === 'json') {
        data = JSON.parse(resp[0].body);
      }

      obj.success(data);
    };

    var onError = function(error) {
      var msg = error.message;
      obj.error(msg);
    };

    return requestPromise(options).then(onReady).catch(onError);
  }
};

module.exports = utils;