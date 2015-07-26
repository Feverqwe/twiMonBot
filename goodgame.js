/**
 * Created by anton on 19.07.15.
 */
var utils = require('./utils');
var apiNormalization = function(data) {
  "use strict";
  if (!data || typeof data !== 'object') {
    console.error('GoodGame bad response!');
    return;
  }
  var now = parseInt(Date.now() / 1000);
  var streams = [];
  for (var streamId in data) {
    var origItem = data[streamId];
    if (origItem.status !== 'Live') {
      continue;
    }
    if (!origItem.key) {
      console.error('GoodGame channel without name!');
    }
    var item = {
      _service: 'goodgame',
      _addItemTime: now,
      _id: origItem.stream_id,
      _isOffline: false,
      _channelName: origItem.key.toLowerCase(),

      viewers: parseInt(origItem.viewers) || 0,
      game: origItem.games,
      preview: origItem.thumb,
      created_at: undefined,
      channel: {
        display_name: undefined,
        name: origItem.key,
        status: origItem.title,
        logo: origItem.img,
        url: origItem.url
      }
    };

    if (item.preview) {
      var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
      item.preview += sep + '_=' + now;
    }

    streams.push(item);
  }
  return streams;
};
var getGoodGameStreamList = function(channelList, cb) {
  "use strict";
  if (!channelList.length) {
    return cb();
  }

  var params = {};
  params.id = channelList.join(',');
  utils.ajax({
    url: 'http://goodgame.ru/api/getchannelstatus?fmt=json&' + utils.param(params),
    dataType: 'json',
    success: function(data) {
      cb(apiNormalization(data));
    },
    error: function(errorMsg) {
      console.error('GoodGame check request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getStreamList = getGoodGameStreamList;

var getChannelName = function(channelName, cb) {
  "use strict";
  var params = {};
  params.id = channelName;
  utils.ajax({
    url: 'http://goodgame.ru/api/getchannelstatus?fmt=json&' + utils.param(params),
    dataType: 'json',
    success: function(data) {
      for (var key in data) {
        var item = data[key];
        if (item.key) {
          return cb(item.key);
        }
      }
      cb();
    },
    error: function(errorMsg) {
      console.error('GoodGame get channelName request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getChannelName = getChannelName;