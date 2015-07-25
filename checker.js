/**
 * Created by Anton on 20.07.2015.
 */
var utils = require('./utils');
var TelegramBot = require('node-telegram-bot-api');
var chacker = {
  storage: {
    token: '',
    timeout: 900,
    chatList: {},
    lastStreamList: {}
  },
  supportServiceList: ['twitch', 'goodgame'],
  bot: null,

  cleanStreamList: function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);

    for (var id in streamList) {
      var item = streamList[id];
      if (now - item._addItemTime > this.storage.timeout && item._isOffline) {
        rmList.push(id);
      }
      item._isOffline = true;
    }

    for (var i = 0; id = rmList[i]; i++) {
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

    for (var id in this.storage.lastStreamList) {
      var cItem = this.storage.lastStreamList[id];
      if (now - cItem._addItemTime < this.storage.timeout && cItem.game === nItem.game && this.isEqualObj(cItem.channel, nItem.channel)) {
        return false;
      }
    }

    return true;
  },

  getChannelList: function() {
    var serviceList = {};
    var channelList;
    var chatList = this.storage.chatList;

    for (var chatId in chatList) {
      var chatItem = chatList[chatId];
      for (var service in chatItem.serviceList) {

        var userChannelList = chatItem.serviceList[service];
        channelList = serviceList[service] = serviceList[service] || [];

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

  onNewStream: function(stream) {
    var textArr = [];

    if (stream.channel.display_name) {
      textArr.push(stream.channel.display_name);
    } else {
      textArr.push(stream.channel.name);
    }

    if (stream.channel.status) {
      textArr.push(stream.channel.status);
    }

    if (stream.game) {
      textArr.push(stream.game);
    }

    if (stream.channel.url) {
      textArr.push(stream.channel.url.substr(stream.channel.url.indexOf('//') + 2));
    }

    if (stream.preview) {
      textArr.push('\n' + stream.preview);
    }

    var text = textArr.join('\n');

    var chatList = this.storage.chatList;

    for (var chatId in chatList) {
      var chatItem = chatList[chatId];

      var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
      if (!userChannelList) {
        continue;
      }

      if (userChannelList.indexOf(stream._channelName) === -1) {
        continue;
      }

      this.bot.sendMessage(chatItem.chatId, text);
    }
  },

  updateList: function(cb) {
    "use strict";
    var lastStreamList = this.storage.lastStreamList;
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
      if (!services[service]) {
        console.error("Service is not found!");
        continue;
      }

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

  initBot: function() {
    "use strict";
    this.bot = new TelegramBot(this.storage.token);
  },

  once: function() {
    "use strict";
    try {
      var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    } catch (e) {
      return console.error("Config is not found!");
    }

    if (config.timeout < config.interval * 60 * 2) {
      config.timeout = parseInt(config.interval * 3 * 60);
      console.log('Timeout auto change!', config.timeout + 'sec.');
    }

    this.storage.timeout = config.timeout;
    this.storage.token = config.token;

    utils.storage.get(['chatList', 'lastStreamList'], function(storage) {
      if (storage.chatList) {
        this.storage.chatList = storage.chatList;
      }
      if (storage.lastStreamList) {
        this.storage.lastStreamList = storage.lastStreamList;
      }

      this.initBot();
      this.updateList();
    }.bind(this));
  }
};

var services = {};
chacker.supportServiceList.forEach(function(service) {
  services[service] = require('./' + service);
});

if (require.main === module) {
  chacker.once();
} else {
  module.exports.init = function(storage) {
    "use strict";
    chacker.storage = storage;
    chacker.initBot();
  };
  module.exports.updateList = chacker.updateList.bind(chacker);
}