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
  stripLinks: function(text) {
    "use strict";
    return text; // .replace(/http:\/\/(www\.)?/g, '');
  },
  ajax: function(obj) {
    "use strict";
    var url = obj.url;

    var method = obj.type || 'GET';
    method.toUpperCase();

    var data = obj.data;
    if (data && typeof data !== "string" && !obj.json) {
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

    if (data && !obj.headers["Content-Type"] && !obj.json) {
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

    if (obj.json) {
      options.json = true;
    }

    if (obj.timeout) {
      options.timeout = obj.timeout;
    } else {
      options.timeout = 15 * 1000; // 15 sec
    }

    var onReady = function(response) {
      var resp = response[0];
      if (!(resp.statusCode >= 200 && resp.statusCode < 300 || resp.statusCode === 304)) {
        throw new Error('Status code: '+resp.statusCode+'\n'+resp.body);
      }

      var data = resp.body;

      if (obj.dataType === 'json') {
        data = JSON.parse(resp.body);
      }

      obj.success(data);
    };

    var onError = function(e) {
      obj.error(e.message);
    };

    return requestPromise(options).then(onReady).catch(onError);
  },
  getDate: function() {
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
  }
};

module.exports = utils;