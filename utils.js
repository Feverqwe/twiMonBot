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
      }
    }
  }(),
  param: function(params) {
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
    var url = obj.url;

    var method = obj.type || 'GET';
    method.toUpperCase();

    var data = obj.data;

    var isFormData = false;

    if (data && typeof data !== "string") {
      isFormData = String(data) === '[object FormData]';
      if (!isFormData) {
        data = utils.param(data);
      }
    }

    if (data && method === 'GET') {
      url += (url.indexOf('?') === -1 ? '?' : '&') + data;
      data = undefined;
    }

    if (obj.cache === false && ['GET','HEAD'].indexOf(method) !== -1) {
      var nc = '_=' + Date.now();
      url += (url.indexOf('?') === -1 ? '?' : '&') + nc;
    }

    var xhr = new xmlhttprequest.XMLHttpRequest();

    xhr.open(method, url, true);

    if (obj.timeout !== undefined) {
      xhr.timeout = obj.timeout;
    }

    if (obj.dataType) {
      obj.dataType = obj.dataType.toLowerCase();

      xhr.responseType = obj.dataType;
    }

    if (!obj.headers) {
      obj.headers = {};
    }

    if (obj.contentType) {
      obj.headers["Content-Type"] = obj.contentType;
    }

    if (data && !obj.headers["Content-Type"] && !isFormData) {
      obj.headers["Content-Type"] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    if (obj.mimeType) {
      xhr.overrideMimeType(obj.mimeType);
    }
    if (obj.headers) {
      for (var key in obj.headers) {
        xhr.setRequestHeader(key, obj.headers[key]);
      }
    }

    if (obj.onTimeout !== undefined) {
      xhr.ontimeout = obj.onTimeout;
    }

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300 || xhr.status === 304) {
        var response = (obj.dataType) ? xhr.response : xhr.responseText;
        if (!response && xhr.responseText) {
          if (obj.dataType === 'json') {
            response = JSON.parse(xhr.responseText);
          }
        }
        return obj.success && obj.success(response, xhr);
      }
      obj.error && obj.error(xhr);
    };

    xhr.onerror = function() {
      obj.error && obj.error(xhr);
    };

    xhr.send(data);

    return xhr;
  }
};
var xmlhttprequest = require("xmlhttprequest");

module.exports = utils;