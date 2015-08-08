/**
 * Created by anton on 19.07.15.
 */
var utils = require('./utils');
var apiNormalization = function(data) {
  "use strict";
  if (!data || !Array.isArray(data.streams)) {
    console.error('Twitch bad response!');
    return;
  }
  var now = parseInt(Date.now() / 1000);
  var streams = [];
  var origStreams = data && data.streams || [];
  for (var i = 0, origItem; origItem = origStreams[i]; i++) {
    if (!origItem.channel || !origItem.channel.name) {
      console.error('Twitch channel without name!');
      continue;
    }

    var item = {
      _service: 'twitch',
      _addItemTime: now,
      _id: origItem._id,
      _isOffline: false,
      _channelName: origItem.channel.name.toLowerCase(),

      viewers: parseInt(origItem.viewers) || 0,
      game: origItem.game,
      preview: origItem.preview && origItem.preview.template,
      created_at: origItem.created_at,
      channel: {
        display_name: origItem.channel.display_name,
        name: origItem.channel.name,
        status: origItem.channel.status,
        logo: origItem.channel.logo,
        url: origItem.channel.url
      }
    };

    if (item.preview && typeof item.preview === 'string') {
      item.preview = item.preview.replace('{width}', '1279').replace('{height}', '720');
      var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
      item.preview += sep + '_=' + now;
    }

    if (!item.channel.url) {
      item.channel.url = 'http://www.twitch.tv/' + item.channel.name;
      if (item.channel.status === undefined) {
        item._isBroken = ['status'];
      }
    }

    streams.push(item);
  }
  return streams;
};
var getTwitchStreamList = function(channelList, cb) {
  "use strict";
  if (!channelList.length) {
    return cb();
  }

  var params = {};
  params.channel = channelList.join(',');
  utils.ajax({
    url: 'https://api.twitch.tv/kraken/streams?limit=100&' + utils.param(params),
    headers: {
      'Accept': 'application/vnd.twitchtv.v3+json'
    },
    dataType: 'json',
    success: function(data) {
      cb(apiNormalization(data));
    },
    error: function(errorMsg) {
      console.error('Twitch check request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getStreamList = getTwitchStreamList;

var getChannelName = function(channelName, cb) {
  "use strict";
  utils.ajax({
    url: 'https://api.twitch.tv/kraken/channels/' + encodeURIComponent(channelName),
    headers: {
      'Accept': 'application/vnd.twitchtv.v3+json'
    },
    dataType: 'json',
    success: function(data) {
      if (!data || !data.name) {
        return cb();
      }
      cb(data.name.toLowerCase());
    },
    error: function(errorMsg) {
      console.error('Twitch get channelName request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getChannelName = getChannelName;