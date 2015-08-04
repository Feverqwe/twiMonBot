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

  isStatusChange: function(cItem, nItem) {
    if (cItem.game !== nItem.game || cItem.channel.status !== nItem.channel.status) {
      return true;
    }

    return false;
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

      if (cItem._service !== nItem._service) {
        continue;
      }

      if (now - cItem._addItemTime < this.storage.timeout && cItem.game === nItem.game && this.isEqualObj(cItem.channel, nItem.channel)) {
        return false;
      }
    }

    return true;
  },

  getChannelList: function() {
    var serviceList = {};
    var chatList = this.storage.chatList;

    for (var chatId in chatList) {
      var chatItem = chatList[chatId];
      for (var service in chatItem.serviceList) {
        var channelList = serviceList[service] = serviceList[service] || [];

        var userChannelList = chatItem.serviceList[service];
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

  getPicId: function(chatId, text, stream, onReady) {
    "use strict";
    var sendPic = function(chatId, request) {
      var timeout = setTimeout(function() {
        console.error('Send photo response timeout!', stream._channelName);
        onReady();
      }, 60 * 1000);
      return this.bot.sendPhoto(chatId, request, {
        caption: text
      }).then(function (msg) {
        clearTimeout(timeout);
        var fileId = msg && msg.photo && msg.photo[0] && msg.photo[0].file_id;

        onReady(fileId);
      }).catch(function() {
        clearTimeout(timeout);
        console.error('Send photo error!', stream._channelName);
        onReady();
      });
    }.bind(this);

    try {
      var request = require("request");
      var req = request(stream.preview);

      req.on('error', function() {
        console.error('Request Error!', stream._channelName);
        return onReady();
      });

      sendPic(chatId, req);
    } catch(e) {
      console.error('Get photo error!', stream._channelName);
      return onReady();
    }
  },

  sendNotify: function(chatIdList, text, noPhotoText, stream) {
    var sendMsg = function(chatId) {
      this.bot.sendMessage(chatId, noPhotoText);
    }.bind(this);

    var sendPic = function(chatId, stream) {
      this.bot.sendPhoto(chatId, stream, {
        caption: text
      });
    }.bind(this);

    var onError = function() {
      while (chatId = chatIdList.shift()) {
        sendMsg(chatId);
      }
    };

    if (!stream.preview) {
      return onError();
    }

    var chatId = chatIdList.shift();
    var fired = false;
    return this.getPicId(chatId, text, stream, function(fileId) {
      if (fired) {
        console.error('Dbl fire getPicId!');
        return;
      }
      fired = true;

      if (!fileId) {
        chatIdList.unshift(chatId);
        return onError();
      }

      while (chatId = chatIdList.shift()) {
        sendPic(chatId, fileId);
      }
    });
  },

  onNewStream: function(stream) {
    var textArr = [];

    // textArr.push(stream.channel.display_name || stream.channel.name);

    var line2 = [];
    if (stream.channel.status) {
      line2.push(stream.channel.status);
    }
    if (stream.game) {
      line2.push(stream.game);
    }
    if (line2.length) {
      textArr.push(line2.join(', '));
    }

    if (stream.channel.url) {
      textArr.push(stream.channel.url.substr(stream.channel.url.indexOf('//') + 2));
    }

    var text = textArr.join('\n');

    if (stream.preview) {
      textArr.push('\n' + stream.preview);
    }

    var noPhotoText = textArr.join('\n');

    var chatList = this.storage.chatList;

    var chatIdList = [];

    for (var chatId in chatList) {
      var chatItem = chatList[chatId];

      var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
      if (!userChannelList) {
        continue;
      }

      if (userChannelList.indexOf(stream._channelName) === -1) {
        continue;
      }

      chatIdList.push(chatItem.chatId);
    }

    chatIdList.length && this.sendNotify(chatIdList, text, noPhotoText, stream);
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

        var cItem = lastStreamList[id];

        if (!cItem) {
          if (item._isNotified = this.isNotDblItem(item)) {
            this.onNewStream(item);
          }
        } else {
          item._isNotified = cItem._isNotified;

          if (!item._isNotified && this.isStatusChange(cItem, item)) {
            item._isNotified = true;
            this.onNewStream(item);
          }
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

      var channelList = serviceChannelList[service];
      while (channelList.length) {
        var arr = channelList.splice(0, 100);
        waitCount++;
        services[service].getStreamList(arr, function(streams) {
          onReady(streams);
        });
      }
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