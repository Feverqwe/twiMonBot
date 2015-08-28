/**
 * Created by anton on 28.08.15.
 */
var utils = require('./utils');
var config = {
  token: null,
  userIdToChannelId: {}
};

var apiNormalization = function(userId, data) {
  "use strict";
  if (!data || typeof data !== 'object' || !data.items) {
    console.error(utils.getDate(), 'Youtube bad response!');
    return;
  }

  var now = parseInt(Date.now() / 1000);
  var streams = [];
  data.items.forEach(function(origItem) {
    var snippet = origItem.snippet;

    if (snippet.liveBroadcastContent !== 'live') {
      return;
    }

    var videoId = origItem.id.videoId;

    var item = {
      _service: 'youtube',
      _addItemTime: now,
      _id: videoId,
      _isOffline: false,
      _channelName: userId.toLowerCase(),

      viewers: parseInt(origItem.viewers) || 0,
      game: origItem.games,
      preview: 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault_live.jpg',
      created_at: snippet.snippet,
      channel: {
        display_name: snippet.channelTitle,
        name: snippet.channelId,
        status: snippet.title,
        url: 'https://gaming.youtube.com/watch?v=' + videoId
      }
    };

    if (typeof item.preview === 'string') {
      var sep = item.preview.indexOf('?') === -1 ? '?' : '&';
      item.preview += sep + '_=' + now;
    }

    streams.push(item);
  });
  return streams;
};

var getYoutubeStreamList = function(userList, cb) {
  "use strict";
  if (!userList.length) {
    return cb();
  }

  var waitCount = 0;
  var readyCount = 0;
  var streamList = [];
  var onReady = function(stream) {
    readyCount++;
    streamList.push.apply(streamList, stream);

    if (readyCount !== waitCount) {
      return;
    }

    cb(streamList);
  };

  userList.forEach(function(userId) {
    waitCount++;
    getChannelId(userId, function(channelId) {
      if (!channelId) {
        return onReady();
      }

      var params = {
        part: 'snippet',
        channelId: channelId,
        eventType: 'live',
        maxResults: 1,
        order: 'date',
        safeSearch: 'none',
        type: 'video',
        fields: 'items(id,snippet)',
        key: config.token
      };
      utils.ajax({
        url: 'https://www.googleapis.com/youtube/v3/search?' + utils.param(params),
        dataType: 'json',
        success: function(data) {
          onReady(apiNormalization(userId, data));
        },
        error: function(errorMsg) {
          console.error(utils.getDate(), 'Youtube check request error!', channelId, errorMsg);
          onReady();
        }
      });
    });
  });
};
module.exports.getStreamList = getYoutubeStreamList;

var getChannelId = function(userId, cb) {
  "use strict";
  if (userId.substr(0, 2) === 'UC') {
    return cb(userId);
  }

  if (config.userIdToChannelId[userId]) {
    return cb(config.userIdToChannelId[userId]);
  }

  var params = {
    part: 'snippet',
    forUsername: userId,
    maxResults: 1,
    fields: 'items/id',
    key: config.token
  };
  utils.ajax({
    url: 'https://www.googleapis.com/youtube/v3/channels?' + utils.param(params),
    dataType: 'json',
    success: function(data) {
      var id = data && data.items && data.items[0] && data.items[0].id;
      if (!id) {
        return cb();
      }

      cb(id);

      config.userIdToChannelId[userId] = id;
      utils.storage.set({userIdToChannelId: config.userIdToChannelId});
    },
    error: function(errorMsg) {
      console.error(utils.getDate(), 'Youtube get channelId by userId request error!', errorMsg);
      cb();
    }
  });
};

var getChannelName = function(userId, cb) {
  "use strict";
  if (!userId || typeof userId !== 'string') {
    return cb();
  }

  getChannelId(userId, function(channelId) {
    if (!channelId) {
      return cb();
    }

    var params = {
      part: 'snippet',
      id: channelId,
      maxResults: 1,
      fields: 'items(id,snippet)',
      key: config.token
    };
    utils.ajax({
      url: 'https://www.googleapis.com/youtube/v3/channels?' + utils.param(params),
      dataType: 'json',
      success: function(data) {
        var id = data && data.items && data.items[0] && data.items[0].id;
        if (!id) {
          return cb();
        }

        cb(userId, id);
      },
      error: function(errorMsg) {
        console.error(utils.getDate(), 'Youtube get channelId request error!', errorMsg);
        cb();
      }
    });
  });
};
module.exports.getChannelName = getChannelName;

module.exports.init = function(token) {
  "use strict";
  config.token = token;
  utils.storage.get('userIdToChannelId', function(storage) {
    if (storage.userIdToChannelId) {
      config.userIdToChannelId = storage.userIdToChannelId;
    }
  });
};