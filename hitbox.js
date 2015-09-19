/**
 * Created by Anton on 17.09.2015.
 */
var utils = require('./utils');
var apiNormalization = function(data) {
  "use strict";
  if (!data || !Array.isArray(data.livestream)) {
    console.error(utils.getDate(), 'HitBox bad response!');
    return;
  }

  var now = parseInt(Date.now() / 1000);
  var streams = [];
  data.livestream.forEach(function(origItem) {
    if (!origItem.channel || !origItem.channel.user_name) {
      console.error(utils.getDate(), 'HitBox channel without name!');
      return;
    }

    if (origItem.media_is_live < 1) {
      return;
    }

    var item = {
      _service: 'hitbox',
      _addItemTime: now,
      _createTime: now,
      _id: origItem.media_id,
      _isOffline: false,
      _channelName: origItem.channel.user_name.toLowerCase(),

      viewers: parseInt(origItem.media_views) || 0,
      game: '',
      preview: origItem.media_thumbnail_large || origItem.media_thumbnail,
      created_at: origItem.media_live_since,
      channel: {
        display_name: origItem.media_display_name,
        name: origItem.media_user_name,
        status: origItem.media_status,
        url: origItem.channel.channel_link
      }
    };

    if (typeof item.preview === 'string') {
      item.preview = 'http://edge.sf.hitbox.tv' + item.preview;
    }

    streams.push(item);
  });

  return streams;
};
var getHitBoxStreamList = function(channelList, cb) {
  "use strict";
  if (!channelList.length) {
    return cb();
  }

  var channels = channelList.map(function(item) {
    return encodeURIComponent(item);
  }).join(',');
  utils.ajax({
    url: 'https://api.hitbox.tv/media/live/' + channels + '?showHidden=true',
    dataType: 'json',
    success: function(data) {
      cb(apiNormalization(data));
    },
    error: function(errorMsg) {
      console.error(utils.getDate(), 'HitBox check request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getStreamList = getHitBoxStreamList;

var getChannelName = function(channelName, cb) {
  "use strict";
  utils.ajax({
    url: 'https://api.hitbox.tv/media/live/' + encodeURIComponent(channelName) + '?showHidden=true',
    dataType: 'json',
    success: function(data) {
      if (!data || !Array.isArray(data.livestream)) {
        return cb();
      }

      var channelName;
      data.livestream.some(function(item) {
        if (item.channel && (channelName = item.channel.user_name)) {
          channelName = channelName.toLowerCase();
          return true;
        }
      });

      cb(channelName);
    },
    error: function(errorMsg) {
      console.error(utils.getDate(), 'HitBox get channelName request error!', errorMsg);
      cb();
    }
  });
};
module.exports.getChannelName = getChannelName;