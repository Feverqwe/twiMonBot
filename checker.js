/**
 * Created by Anton on 20.07.2015.
 */
var streamLog = true;
var utils = require('./utils');
var TelegramBot = require('node-telegram-bot-api');
var chacker = {
  storage: null,
  language: null,
  bot: null,

  cleanStreamList: function(streamList) {
    var rmList = [];
    var now = parseInt(Date.now() / 1000);

    for (var i = 0, item; item = streamList[i]; i++) {
      if (now - item._addItemTime > this.storage.timeout && item._isOffline) {
        rmList.push(item);
        streamLog && console.log('[s]', utils.getDate(), 'R     ', item._channelName, '#', item.channel.status, '#', item.game);
      }
      item._isOffline = true;
    }

    for (i = 0; item = rmList[i]; i++) {
      streamList.splice(streamList.indexOf(item), 1);
    }
  },

  getBrokenItems: function(cItem, nItem) {
    "use strict";
    var brokenItems = [];
    [cItem, nItem].forEach(function(item) {
      if (!item._isBroken) {
        return;
      }
      for (var n = 0, key; key = item._isBroken[n]; n++) {
        if (brokenItems.indexOf(key) === -1) {
          brokenItems.push(key);
        }
      }
    });
    return brokenItems;
  },

  isStatusChange: function(cItem, nItem) {
    var brokenItems = this.getBrokenItems(cItem, nItem);

    if (cItem.game !== nItem.game && brokenItems.indexOf('game') === -1) {
      return true;
    }

    if (cItem.channel.status !== nItem.channel.status && brokenItems.indexOf('status') === -1) {
      return true;
    }

    return false;
  },

  isEqualChannel: function(cItem, nItem) {
    var brokenItems = this.getBrokenItems(cItem, nItem);

    var a = cItem.channel;
    var b = nItem.channel;
    for (var key in a) {
      if (brokenItems.indexOf(key) !== -1) {
        continue;
      }
      if (a[key] !== b[key]) {
        return false;
      }
    }
    return true;
  },

  isNotDblItem: function(nItem) {
    var now = parseInt(Date.now() / 1000);

    var lastStreamList = this.storage.lastStreamList;

    for (var i = 0, cItem; cItem = lastStreamList[i]; i++) {
      if (cItem._service !== nItem._service) {
        continue;
      }

      if (now - cItem._addItemTime < this.storage.timeout && cItem.game === nItem.game && this.isEqualChannel(cItem, nItem)) {
        return false;
      }
    }

    return true;
  },

  getChannelList: function() {
    "use strict";
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

  onSendMsgError: function(e, chatId) {
    var errorMsg = e && e.message || '<not error msg>';

    var isError = [
      'Bot was kicked from a chat',
      'Bad Request: wrong chat id',
      'PEER_ID_INVALID'
    ].some(function(desc) {
      if (errorMsg.indexOf(desc) !== -1) {
        return true;
      }
    });

    if (!isError) {
      return;
    }

    var needSave = false;
    var storage = this.storage;
    for (var _chatId in storage.chatList) {
      var item = storage.chatList[_chatId];
      if (item.chatId === chatId) {
        console.error(utils.getDate(), 'Remove chat', chatId, '\n', JSON.stringify(item));
        delete storage.chatList[_chatId];
        needSave = true;
      }
    }

    needSave &&  utils.storage.set({chatList: storage.chatList});
  },

  getPicId: function(chatId, text, stream, onReady) {
    "use strict";
    var sendPic = function(chatId, request) {
      return this.bot.sendPhoto(chatId, request, {
        caption: text
      }).then(function (msg) {
        var fileId = msg && msg.photo && msg.photo[0] && msg.photo[0].file_id;

        onReady(fileId);

        this.track(chatId, stream, 'sendPhoto');
      }.bind(this)).catch(function(e) {
        console.error(utils.getDate(), 'Send msg with photo error!', chatId, stream._channelName, '\n', e && e.message);

        this.onSendMsgError(e, chatId);

        onReady();
      }.bind(this));
    }.bind(this);

    try {
      var request = require("request");
      var req = request(stream.preview);

      req.on('error', function() {
        console.error(utils.getDate(), 'Request photo error!', stream._channelName, '\n', stream.preview);
        return onReady();
      });

      sendPic(chatId, req);
    } catch(e) {
      console.error(utils.getDate(), 'Request photo exception!', stream._channelName, '\n', e.message);
      return onReady();
    }
  },

  sendNotify: function(chatIdList, text, noPhotoText, stream) {
    var sendMsg = function(chatId) {
      this.bot.sendMessage(chatId, noPhotoText, {
        parse_mode: 'Markdown'
      }).then(function() {
        this.track(chatId, stream, 'sendMsg');
      }.bind(this)).catch(function(e) {
        console.error(utils.getDate(), 'Send msg without photo error!', chatId, stream._channelName, '\n', e && e.message);

        this.onSendMsgError(e, chatId);
      }.bind(this));
    }.bind(this);

    var sendPic = function(chatId, fileId) {
      this.bot.sendPhoto(chatId, fileId, {
        caption: text
      }).then(function() {
        this.track(chatId, stream, 'sendPhoto');
      }.bind(this)).catch(function(e) {
        console.error(utils.getDate(), 'Send msg with photo id error!', chatId, stream._channelName, '\n', e && e.message);

        this.onSendMsgError(e, chatId);
      }.bind(this));
    }.bind(this);

    var onError = function() {
      console.error(utils.getDate(), 'Sending msg without photo!', stream._channelName);
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
        console.error(utils.getDate(), 'Dbl fire getPicId!');
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

  getNowStreamPhotoText: function(stream) {
    "use strict";
    var textArr = [];

    var line = [];
    if (stream.channel.status) {
      line.push(stream.channel.status);
    }
    if (stream.game) {
      line.push(stream.game);
    }
    if (line.length) {
      textArr.push(line.join(', '));
    }

    if (stream.channel.url) {
      textArr.push(stream.channel.url);
    }

    return textArr.join('\n');
  },

  getNowStreamText: function(stream) {
    "use strict";
    var textArr = [];

    var line = [];
    if (stream.channel.status) {
      line.push(stream.channel.status);
    }
    if (stream.game) {
      line.push('_'+stream.game+'_');
    }
    if (line.length) {
      textArr.push(line.join(', '));
    }

    line = [];
    if (stream.channel.url) {
      var channelName = '*' + (stream.channel.display_name || stream.channel.name) + '*';
      line.push(this.language.watchOn
          .replace('{channelName}', channelName)
          .replace('{serviceName}', '['+this.serviceToTitle[stream._service]+']'+'('+stream.channel.url+')')
      );
    }
    if (stream.preview) {
      line.push('('+'['+this.language.preview+']' + '('+stream.preview+')'+')');
    }
    if (line.length) {
      textArr.push(line.join(' '));
    }

    return textArr.join('\n');
  },

  onNewStream: function(stream) {
    "use strict";
    var text = this.getNowStreamPhotoText(stream);
    var noPhotoText = this.getNowStreamText(stream);

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

      var now = parseInt(Date.now() / 1000);
      streamList.forEach(function(item) {
        var cItem = null;

        lastStreamList.some(function(exItem, index) {
          if (exItem._service === item._service && exItem._id === item._id) {
            cItem = exItem;
            lastStreamList.splice(index, 1);
            return true;
          }
        });

        if (!cItem) {
          if (item._isNotified = this.isNotDblItem(item)) {
            this.onNewStream(item);
            streamLog && console.log('[s]', utils.getDate(), 'NewN  ', item._channelName, '#', item.channel.status, '#', item.game);
          } else {
            streamLog && console.log('[s]', utils.getDate(),'isDbl ', item._channelName, '#', item.channel.status, '#', item.game);
          }
        } else {
          item._isNotified = cItem._isNotified;
          item._notifyTimeout = cItem._notifyTimeout;
          item._createTime = cItem._createTime;

          if (item._isNotified && item._notifyTimeout < now) {
            item._isNotified = false;
            delete item._notifyTimeout;
          }

          if (!item._isNotified && this.isStatusChange(cItem, item)) {
            item._isNotified = true;
            this.onNewStream(item);
            streamLog && console.log('[s]', utils.getDate(),'ExN   ', item._channelName, '#', item.channel.status, '#', item.game);
          }
        }

        if (item._isNotified && !item._notifyTimeout) {
          item._notifyTimeout = now + this.storage.notifyTimeout * 60;
        }

        lastStreamList.push(item);
      }.bind(this));

      utils.storage.set({lastStreamList: lastStreamList}, function() {
        cb && cb();
      });
    }.bind(this);

    var serviceChannelList = this.getChannelList();

    for (var service in serviceChannelList) {
      if (!services[service]) {
        console.error(utils.getDate(), 'Service is not found!', service);
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

  track: function(chatId, stream, title) {
    "use strict";
    try {
      botan.track({
        text: stream._channelName,
        from: {
          id: 1
        },
        chat: {
          id: chatId
        },
        date: parseInt(Date.now() / 1000)
      }, title);
    } catch(e) {
      console.error(utils.getDate(), 'Botan track error', e.message);
    }
  }
};

var services = null;
var botan = null;

module.exports.init = function(storage, language, _services, _serviceToTitle, _botan) {
  "use strict";
  chacker.storage = storage;
  chacker.language = language;
  chacker.serviceToTitle = _serviceToTitle;
  services = _services;
  botan = _botan;
  chacker.initBot();
};
module.exports.updateList = chacker.updateList.bind(chacker);