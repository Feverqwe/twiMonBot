/**
 * Created by Anton on 19.07.2015.
 */
var engine = {
  storage: undefined,
  varCache: {
    lastStreamList: {
      meta: {}
    },
    twitch: {
      pWidth: 853,
      pHeight: 480
    },
    goodgame: {
      pWidth: 320,
      pHeight: 240
    }
  },
  defaultPreferences: {
    list: [
      {channel: 'opergamer'}
    ],
    interval: 1
  },
  preferences: {},
  loadSettings: function(cb) {
    var prefList = [];
    for (var key in engine.defaultPreferences) {
      prefList.push(key);
    }

    utils.storage.get(prefList, function(storage) {
      for (var i = 0, key; key = prefList[i]; i++) {
        if (storage.hasOwnProperty(key)) {
          engine.preferences[key] = storage[key];
          continue;
        }
        engine.preferences[key] = engine.defaultPreferences[key];
      }

      engine.preferences.timeout = 300;
      if (engine.preferences.timeout < engine.preferences.interval * 60 * 2) {
        engine.preferences.timeout = parseInt(engine.preferences.interval * 3);
      }

      utils.storage.get(['lastStreamList'], function(storage) {
        if (storage.hasOwnProperty('lastStreamList')) {
          if (storage.lastStreamList.meta === undefined) {
            storage.lastStreamList.meta = {};
          }
          engine.varCache.lastStreamList = storage.lastStreamList;
        }
        cb();
      });
    });
  },
  getTwitchStreamList: function(data, cb) {
    utils.ajax({
      url: 'https://api.twitch.tv/kraken/streams?' + utils.param(data),
      dataType: 'json',
      success: function(data) {
        cb(data);
      },
      error: function() {
        cb();
      }
    });
  },
  convertGoodGameApi: function(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return;
    }
    var streams = [];
    for (var streamId in data) {
      var origItem = data[streamId];
      if (origItem.status !== 'Live') {
        continue;
      }
      var item = {
        _service: 'goodgame',
        _id: origItem.stream_id,
        game: origItem.games,
        preview: {
          template: origItem.thumb
        },
        created_at: undefined,
        channel: {
          display_name: undefined,
          name: origItem.key,
          status: origItem.title,
          logo: origItem.img,
          url: origItem.url
        }
      };
      streams.push(item);
    }
    return {streams: streams};
  },
  getGoodGameStreamList: function(data, cb) {
    utils.ajax({
      url: 'http://goodgame.ru/api/getchannelstatus?fmt=json&' + utils.param(data),
      dataType: 'json',
      success: function(data) {
        cb(this.convertGoodGameApi(data));
      }.bind(this),
      error: function() {
        cb();
      }
    });
  },
  checkStream: function(data, cb) {
    var streams;
    var result = {
      streams: streams = []
    };
    var service = data.__service;
    delete data.__service;
    if (service === 'twitch') {
      this.getTwitchStreamList(data, function (data) {
        if (data && data.streams) {
          streams.push.apply(streams, data.streams);
        }
        cb(result);
      });
    } else
    if (service === 'goodgame') {
      data.id = data.channel;
      delete data.channel;
      this.getGoodGameStreamList(data, function (data) {
        if (data && data.streams) {
          streams.push.apply(streams, data.streams);
        }
        cb(result);
      });
    }
  },
  createPreview: function(stream, cb) {
    if (!stream.preview.template) {
      return cb();
    }
    var service = stream._service;
    var imageUrl = stream.preview.template.replace('{width}', engine.varCache[service].pWidth).replace('{height}', engine.varCache[service].pHeight);
    cb(imageUrl);
  },
  onNewStream: function(stream) {
    var title = stream.channel.display_name || stream.channel.name;
    var message = stream.channel.status || '';
    if (message) {
      message = '\n' + message;
    }

    engine.createPreview(stream, function(imageUrl) {
      var text = title + message;

      text += '\n' + imageUrl;

      bot.sendMessage({
        chat_id: bot.chat_id,
        text: text
      });
    });
  },
  onGetStreamList: function(streamList) {
    var onlineCount = 0;
    if (streamList !== undefined) {
      onlineCount = streamList.length;
    } else {
      streamList = engine.varCache.lastStreamList;
      for (var id in streamList) {
        if (id === 'meta') continue;
        var item = streamList[id];
        if (item._isOffline) continue;
        onlineCount++;
      }
    }
  },
  channelListOpt: function() {
    var fastList = [];
    var optimization = {
      twChList: [],
      ggChList: []
    };
    for (var i = 0, item; item = engine.preferences.list[i]; i++) {
      if (!item.__service) {
        item.__service = 'twitch';
      }
      if (Object.keys(item).length === 2 && item.hasOwnProperty('channel')) {
        if (item.__service === 'twitch') {
          optimization.twChList.push(item.channel);
        } else
        if (item.__service === 'goodgame') {
          optimization.ggChList.push(item.channel);
        }
        continue;
      }
      fastList.push(item);
    }
    if (optimization.twChList.length > 0) {
      fastList.push({channel: optimization.twChList.join(','), __service: 'twitch'});
    }
    if (optimization.ggChList.length > 0) {
      fastList.push({channel: optimization.ggChList.join(','), __service: 'goodgame'});
    }
    return fastList;
  },
  cleanStreamList: function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);
    for (var id in streamList) {
      if (id === 'meta') continue;
      var item = streamList[id];
      // remove item after 5 min
      if (now - item._addItemTime > engine.preferences.timeout && item._isOffline) {
        rmList.push(id);
      }
      item._isOffline = true;
    }
    for (var i = 0, id; id = rmList[i]; i++) {
      delete streamList[id];
    }
  },
  isEqualObj: function(a, b) {
    for (var key in a) {
      if (a[key] !== b[key]) {
        return false;
      }
    }
    return true;
  },
  isNotDblItem: function(nItem) {
    var now = parseInt(Date.now() / 1000);
    for (var id in engine.varCache.lastStreamList) {
      if (id === 'meta') continue;
      var cItem = engine.varCache.lastStreamList[id];
      if (now - cItem._addItemTime < engine.preferences.timeout && cItem.game === nItem.game && engine.isEqualObj(cItem.channel, nItem.channel)) {
        return false;
      }
    }
    return true;
  },
  updateList: function(cb) {
    engine.cleanStreamList(engine.varCache.lastStreamList);
    var streamList = [];
    var waitCount = 0;
    var readyCount = 0;
    var onReady = function() {
      readyCount++;
      if (readyCount !== waitCount) {
        return;
      }
      engine.onGetStreamList(streamList);
      var now = parseInt(Date.now() / 1000);
      for (var i = 0, origItem; origItem = streamList[i]; i++) {
        var newItem = {
          _service: origItem._service || 'twitch',
          _addItemTime: now,
          _id: origItem._id,
          _isOffline: false,
          game: origItem.game,
          preview: {
            template: origItem.preview.template
          },
          created_at: origItem.created_at,
          channel: {
            display_name: origItem.channel.display_name,
            name: origItem.channel.name,
            status: origItem.channel.status,
            logo: origItem.channel.logo,
            url: origItem.channel.url
          }
        };
        var _id = newItem._id;
        if (!engine.varCache.lastStreamList.hasOwnProperty(_id) && engine.isNotDblItem(newItem)) {
          engine.onNewStream(newItem);
        }
        engine.varCache.lastStreamList[_id] = newItem;
      }
      engine.varCache.lastStreamList.meta.syncTime = now;
      utils.storage.set({
        lastStreamList: engine.varCache.lastStreamList
      }, function() {
        cb && cb();
      });
    };

    var list = engine.channelListOpt(engine.preferences.list);

    if (list.length === 0) {
      waitCount++;
      return onReady();
    }

    for (var i = 0, item; item = list[i]; i++) {
      waitCount++;
      engine.checkStream(item, function(data) {
        if (data.streams.length === 0) return onReady();
        streamList.push.apply(streamList, data.streams);
        onReady();
      });
    }
  },
  onPreferenceChange: {
    list: function() {
      engine.updateList();
    }
  },
  once: function() {
    "use strict";
    var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    bot.token = config.token;
    bot.user_id = config.userId;

    utils.storage.get(['offset', 'chat_id'], function(storage) {
      if (storage.chat_id) {
        bot.offset = storage.offset || 0;
        bot.chat_id = storage.chat_id;
      }

      engine.loadSettings(function() {
        bot.getUpdates(function() {
          if (!bot.chat_id) {
            throw "Chat id is not defined!";
          }

          utils.storage.set({
            offset: bot.offset || 0,
            chat_id: bot.chat_id
          });

          engine.updateList();
        });
      });
    });
  }
};
var utils = require('./utils');
var bot = require('./bot');

engine.once();