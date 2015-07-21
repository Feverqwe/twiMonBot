/**
 * Created by Anton on 20.07.2015.
 */
var chacker = {
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
  supportServiceList: ['twitch', 'goodgame'],

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
    var serviceList = {};
    var channelList;
    var userList = this.preferences.userList;

    for (var user_id in userList) {
      var user = userList[user_id];
      for (var service in user.serviceList) {

        var userChannelList = user.serviceList[service];
        if (!(channelList = serviceList[service])) {
          serviceList[service] = channelList = [];
        }

        for (var i = 0, channelName; channelName = userChannelList[i]; i++) {
          if (channelList.indexOf(channelName) !== -1) {
            continue;
          }
          channelList.push(channelName);
        }

      }

    }
    return serviceList;
  },

  getPreview: function(stream, cb) {
    if (!stream.preview.template) {
      return cb();
    }
    var service = stream._service;
    var imageUrl = stream.preview.template.replace('{width}', this.varCache[service].pWidth).replace('{height}', this.varCache[service].pHeight);

    var sep = imageUrl.indexOf('?') === -1 ? '?' : '&';

    imageUrl += sep + '_t=' + Date.now();

    cb(imageUrl);
  },

  onNewStream: function(stream) {
    var text = [];
    if (stream.channel.display_name) {
      text.push(stream.channel.display_name);
    } else {
      text.push(stream.channel.name);
    }
    if (stream.channel.status) {
      text.push(stream.channel.status);
    }
    if (stream.game) {
      text.push(stream.game);
    }
    if (stream.channel.url) {
      text.push(stream.channel.url.substr(stream.channel.url.indexOf('//') + 2));
    }

    this.getPreview(stream, function(imageUrl) {
      text.push('\n'+imageUrl);

      text = text.join('\n');
      
      var ddblChatId = {};
      var userList = this.preferences.userList;
      for (var user_id in userList) {
        var user = userList[user_id];
        var userChannelList;
        if (!(userChannelList = user.serviceList[stream._service])) {
          continue;
        }
        if (userChannelList.indexOf(stream._channelName) !== -1) {
          if (ddblChatId[user.chat_id] === 1) {
            continue;
          }
          ddblChatId[user.chat_id] = 1;

          bot.sendMessage({
            chat_id: user.chat_id,
            text: text
          });
        }
      }
    }.bind(this));
  },

  updateList: function(cb) {
    "use strict";
    var lastStreamList = this.preferences.lastStreamList;
    this.cleanStreamList(lastStreamList);

    var streamList = [];

    var waitCount = 0;
    var readyCount = 0;
    var onReady = function(streams) {
      readyCount++;

      if (streams && streams.length) {
        streamList.push.apply(streamList, streams);
      }

      if (readyCount !== waitCount) {
        return;
      }

      for (var i = 0, item; item = streamList[i]; i++) {
        var id = item._id;

        if (!lastStreamList[id] && this.isNotDblItem(item)) {
          this.onNewStream(item);
        }

        lastStreamList[id] = item;
      }

      utils.storage.set({lastStreamList: lastStreamList}, function() {
        cb && cb();
      });
    }.bind(this);

    var serviceChannelList = this.getChannelList();

    for (var service in serviceChannelList) {
      waitCount++;
      services[service](serviceChannelList[service], function(streams) {
        onReady(streams);
      });
    }

    waitCount++;
    utils.storage.set({lastStreamList: lastStreamList}, function() {
      onReady();
    });
  },

  loadConfig: function() {
    var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    bot.token = config.token;
    this.defaultPreferences = config.defaultPreferences;
  },

  once: function() {
    "use strict";
    this.loadConfig();
    this.loadSettings(function() {
      this.updateList();
    }.bind(this));
  }
};

var utils = require('./utils');
var bot = require('./bot');
var services = {};
chacker.supportServiceList.forEach(function(service) {
  services[service] = require('./'+service);
});

if(require.main === module) {
  chacker.once();
} else {
  module.exports.init = function(preferences) {
    "use strict";
    chacker.loadConfig();
    chacker.preferences = preferences;
  };
  module.exports.updateList = chacker.updateList.bind(chacker);
}