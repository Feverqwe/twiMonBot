/**
 * Created by Anton on 19.07.2015.
 */
var engine = {
  varCache: {
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
    userList: {},
    lastStreamList: {},
    interval: 1,
    timeout: 300
  },
  preferences: {},

  loadSettings: function(cb) {
    var prefList = [];
    for (var key in this.defaultPreferences) {
      prefList.push(key);
    }

    utils.storage.get(prefList, function(storage) {
      for (var i = 0, key; key = prefList[i]; i++) {
        if (storage[key]) {
          this.preferences[key] = storage[key];
          continue;
        }
        this.preferences[key] = this.defaultPreferences[key];
      }

      if (this.preferences.timeout < this.preferences.interval * 60 * 2) {
        this.preferences.timeout = parseInt(this.preferences.interval * 3);
      }

      cb();
    }.bind(this));
  },

  getPreview: function(stream, cb) {
    if (!stream.preview.template) {
      return cb();
    }
    var service = stream._service;
    var imageUrl = stream.preview.template.replace('{width}', this.varCache[service].pWidth).replace('{height}', this.varCache[service].pHeight);
    cb(imageUrl);
  },

  onNewStream: function(stream) {
    var title = stream.channel.display_name || stream.channel.name;
    var message = stream.channel.status || '';
    if (message) {
      message = '\n' + message;
    }

    this.getPreview(stream, function(imageUrl) {
      var text = title + message;

      text += '\n' + imageUrl;

      bot.sendMessage({
        chat_id: bot.chat_id,
        text: text
      });
    });
  },

  cleanStreamList: function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);
    for (var id in streamList) {
      var item = streamList[id];
      if (now - item._addItemTime > this.preferences.timeout && item._isOffline) {
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
    for (var id in this.preferences.lastStreamList) {
      var cItem = this.preferences.lastStreamList[id];
      if (now - cItem._addItemTime < this.preferences.timeout && cItem.game === nItem.game && this.isEqualObj(cItem.channel, nItem.channel)) {
        return false;
      }
    }
    return true;
  },

  getChannelList: function() {
    var channelList = {};
    for (var userId in this.preferences.userList) {
      var item = this.preferences.userList[userId];
      if (!channelList[item.service]) {
        channelList[item.service] = [];
      }
      channelList[item.service].push(item.channel);
    }
    return channelList;
  },

  updateList: function(cb) {
    this.cleanStreamList(this.preferences.lastStreamList);

    var streamList = [];

    var waitCount = 1;
    var readyCount = 0;
    var onReady = function(streams) {
      readyCount++;

      if (streams && streams.length) {
        streamList.push.apply(streamList, streams);
      }

      if (readyCount !== waitCount) {
        return;
      }

      var now = parseInt(Date.now() / 1000);
      var lastStreamList = this.preferences.lastStreamList;

      for (var i = 0, origItem; origItem = streamList[i]; i++) {
        var _id;
        var newItem = {
          _service: origItem._service,
          _addItemTime: now,
          _id: _id = origItem._id,
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

        if (!lastStreamList[_id] && this.isNotDblItem(newItem)) {
          this.onNewStream(newItem);
        }

        lastStreamList[_id] = newItem;
      }

      cb && cb();
    }.bind(this);

    var serviceChannelList = this.getChannelList();

    for (var service in serviceChannelList) {
      waitCount++;
      require('./'+service)(serviceChannelList[service], function(streams) {
        onReady(streams);
      });
    }

    onReady();
  },

  once: function() {
    "use strict";
    var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    bot.token = config.token;
    bot.user_id = config.userId;
    this.defaultPreferences = config.defaultPreferences;

    utils.storage.get(['offset', 'chat_id'], function(storage) {
      if (storage.chat_id) {
        bot.offset = storage.offset || 0;
        bot.chat_id = storage.chat_id;
      }

      this.loadSettings(function() {
        bot.getUpdates(function() {
          if (!bot.chat_id) {
            throw "Chat id is not defined!";
          }

          utils.storage.set({
            offset: bot.offset || 0,
            chat_id: bot.chat_id
          });

          this.updateList();
        }.bind(this));
      }.bind(this));
    }.bind(this));
  }
};
var utils = require('./utils');
var bot = require('./bot');

engine.once();