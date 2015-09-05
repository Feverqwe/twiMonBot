/**
 * Created by Anton on 19.07.2015.
 */
var checker = null;
var utils = require('./utils');
var TelegramBot = require('node-telegram-bot-api');
var botPolling = require('./botPolling');
var debug = require('debug')('chat');
var rmStateLog = true;
var chat = {
  storage: {
    token: null,
    timeout: 900,
    notifyTimeout: 180,
    interval: 5,
    chatList: {},
    lastStreamList: [],
    botanToken: ""
  },
  stateList: {},
  supportServiceList: ['youtube', 'twitch', 'goodgame'],
  serviceToTitle: {
    goodgame: 'GoodGame',
    twitch: 'Twitch',
    youtube: 'Youtube'
  },
  bot: null,
  serviceMap: {
    gg: 'goodgame',
    tw: 'twitch',
    yt: 'youtube'
  },
  language: {
    help: "{help}",
    offline: "{offline}",
    emptyServiceList: "{emptyServiceList}",
    enterChannelName: "{enterChannelName}",
    enterService: "{enterService}",
    serviceIsNotSupported: "{serviceIsNotSupported}",
    channelExists: "{channelExists}",
    channelAdded: "{channelAdded}",
    commandCanceled: "{commandCanceled}",
    channelDontExist: "{channelDontExist}",
    channelDeleted: "{channelDeleted}",
    cleared: "{cleared}",
    channelList: "{channelList}",
    channelNameIsEmpty: "{channelNameIsEmpty}",
    selectDelChannel: "{selectDelChannel}",
    channelIsNotFound: "{channelIsNotFound}",
    users: "{users}",
    channels: "{channels}"
  },
  options: {
    hideKeyboard: {
      reply_markup: JSON.stringify({
        hide_keyboard: true,
        selective: true
      })
    }
  },
  getServiceListKeyboard: function() {
    "use strict";
    var last = [];
    var btnList = [last];
    for (var i = 0, service; service = this.supportServiceList[i]; i++) {
      if (last.length === 2) {
        last = [];
        btnList.push(last);
      }
      last.push(this.serviceToTitle[service]);
    }
    btnList.push(['Cancel']);

    return btnList;
  },
  clearStateList: function() {
    "use strict";
    var chatId, i;
    var aliveTime = Date.now() - 5 * 60 * 1000;
    var rmList = [];
    var stateList = this.stateList;
    for (chatId in stateList) {
      var func = stateList[chatId];
      if (func.now < aliveTime) {
        rmList.push(chatId);
        rmStateLog && console.log('[c]', utils.getDate(), 'rmState', chatId, func.command || '');
      }
    }
    for (i = 0, chatId; chatId = rmList[i]; i++) {
      delete stateList[chatId];
    }
  },
  sceneList: {
    waitChannelName: function(data, msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.stateList[chatId] = function(msg) {
        data.push(msg.text);

        _this.sceneList.waitServiceName(data, msg);
      };
      _this.stateList[chatId].command = 'add';
      _this.stateList[chatId].now = Date.now();

      _this.bot.sendMessage(
        chatId,
        _this.language.enterChannelName
      );
    },
    waitServiceName: function(data, msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.stateList[chatId] = function(msg) {
        "use strict";
        data.push(msg.text);
        msg.text = '/a ' + data.join(' ');
        _this.onMessage(msg);
      };
      _this.stateList[chatId].command = 'add';
      _this.stateList[chatId].now = Date.now();

      _this.bot.sendMessage(chatId, _this.language.enterService, {
        reply_markup: JSON.stringify({
          keyboard: _this.getServiceListKeyboard(),
          resize_keyboard: true,
          one_time_keyboard: true,
          selective: true
        })
      });
    }
  },
  getStreamText: function(stream) {
    var textArr = [];

    textArr.push(stream.channel.display_name || stream.channel.name);

    
    var line2 = [];
    if (stream.viewers || stream.viewers === 0) {
      line2.push(stream.viewers);
    }
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
      textArr.push(stream.channel.url);
    }

    if (stream.preview) {
      textArr.push(stream.preview);
    }

    return textArr.join('\n');
  },
  actionList: {
    /**
     * @param {{chat: {id: Number}}} msg
     */
    ping: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.bot.sendMessage(chatId, "pong");
    },
    start: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.bot.sendMessage(chatId, _this.language.help);
    },
    help: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.bot.sendMessage(chatId, _this.language.help);
    },
    a: function(msg, channelName, service) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatList = _this.storage.chatList;

      services[service].getChannelName(channelName, function(_channelName, channelId) {
        if (!_channelName) {
          return _this.bot.sendMessage(
            chatId,
            _this.language.channelIsNotFound
              .replace('{channelName}', channelName)
              .replace('{serviceName}', _this.serviceToTitle[service]),
            _this.options.hideKeyboard
          );
        }
        channelName = _channelName;

        var chatItem = chatList[chatId] = chatList[chatId] || {};
        chatItem.chatId = chatId;

        var serviceList = chatItem.serviceList = chatItem.serviceList || {};
        var channelList = serviceList[service] = serviceList[service] || [];

        if (channelList.indexOf(channelName) !== -1) {
          return _this.bot.sendMessage(chatId, _this.language.channelExists, _this.options.hideKeyboard);
        }

        channelList.push(channelName);

        var displayName = [channelName];
        if (channelId) {
          displayName.push('(' + channelId + ')');
        }

        utils.storage.set({chatList: chatList}, function() {
          return _this.bot.sendMessage(
            chatId,
            _this.language.channelAdded
              .replace('{channelName}', displayName.join(' '))
              .replace('{serviceName}', _this.serviceToTitle[service]),
            _this.options.hideKeyboard
          );
        });
      });
    },
    add: function(msg, channelName, serviceName) {
      "use strict";
      var _this = chat;

      var data = [];
      channelName && data.push(channelName);
      channelName && serviceName && data.push(serviceName);

      if (data.length === 0) {
        _this.sceneList.waitChannelName(data, msg);
      } else
      if (data.length === 1) {
        _this.sceneList.waitServiceName(data, msg);
      } else {
        msg.text = '/a ' + data.join(' ');
        _this.onMessage(msg);
      }
    },
    d: function(msg, channelName, service) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatList = _this.storage.chatList;
      var chatItem = chatList[chatId];

      var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[service];

      if (!channelList) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList, _this.options.hideKeyboard);
      }

      var pos = channelList.indexOf(channelName);
      if (pos === -1) {
        return _this.bot.sendMessage(chatId, _this.language.channelDontExist, _this.options.hideKeyboard);
      }

      channelList.splice(pos, 1);

      if (channelList.length === 0) {
        delete chatItem.serviceList[service];

        if (Object.keys(chatItem.serviceList).length === 0) {
          delete chatList[chatId];
        }
      }

      utils.storage.set({chatList: chatList}, function() {
        return _this.bot.sendMessage(
          chatId,
          _this.language.channelDeleted
            .replace('{channelName}', channelName)
            .replace('{serviceName}', _this.serviceToTitle[service]),
          _this.options.hideKeyboard
        );
      });
    },
    delete: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList, _this.options.hideKeyboard);
      }

      _this.stateList[chatId] = function(msg) {
        var data = msg.text.match(/^(.+) \((.+)\)$/);
        if (!data) {
          debug("Can't match delete channel");
          return;
        }
        data.shift();

        msg.text = '/d ' + data.join(' ');
        _this.onMessage(msg);
      };
      _this.stateList[chatId].command = 'delete';
      _this.stateList[chatId].now = Date.now();

      var btnList = [];
      for (var service in chatItem.serviceList) {
        var channelList = chatItem.serviceList[service];
        for (var i = 0, channelName; channelName = channelList[i]; i++) {
          btnList.push([channelName + ' (' + _this.serviceToTitle[service] + ')']);
        }
      }
      btnList.push(['Cancel']);

      _this.bot.sendMessage(chatId, _this.language.selectDelChannel, {
        reply_markup: JSON.stringify({
          keyboard: btnList,
          resize_keyboard: true,
          one_time_keyboard: true,
          selective: true
        })
      });
    },
    cancel: function(msg, arg1) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.bot.sendMessage(
        chatId,
        _this.language.commandCanceled
          .replace('{command}', arg1 || ''),
        _this.options.hideKeyboard
      );
    },
    clear: function(msg, isYes) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      if (!isYes) {
        return _this.bot.sendMessage(chatId, _this.language.clearSure);
      }

      if (isYes !== 'yes') {
        return;
      }

      delete _this.storage.chatList[chatId];

      utils.storage.set({chatList: _this.storage.chatList}, function() {
        _this.bot.sendMessage(
          chatId,
          _this.language.cleared
        );
      });
    },
    list: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      var serviceList = [];
      for (var service in chatItem.serviceList) {
        serviceList.push(_this.serviceToTitle[service] + ': ' + chatItem.serviceList[service].join(', '));
      }

      _this.bot.sendMessage(
        chatId,
        serviceList.join('\n\n')
      );
    },
    online: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      var onLineList = [];
      var lastStreamList = _this.storage.lastStreamList;

      for (var service in chatItem.serviceList) {
        var userChannelList = chatItem.serviceList[service];

        var channelList = [];

        for (var i = 0, stream; stream = lastStreamList[i]; i++) {
          if (stream._isOffline || stream._service !== service) {
            continue;
          }

          if (userChannelList.indexOf(stream._channelName) !== -1) {
            channelList.push(_this.getStreamText(stream));
          }
        }

        channelList.length && onLineList.push(channelList.join('\n\n'));
      }

      if (!onLineList.length) {
        onLineList.unshift(_this.language.offline);
      }

      var text = utils.stripLinks(onLineList.join('\n\n'));

      _this.bot.sendMessage(chatId, text, {
        disable_web_page_preview: true
      });
    },
    top: function(msg) {
      var service, channelList, channelName;
      var _this = chat;
      var chatId = msg.chat.id;
      var chatList = _this.storage.chatList;

      var userCount = 0;
      var channelCount = 0;

      var top = {};
      for (var _chatId in chatList) {
        var chatItem = chatList[_chatId];
        if (!chatItem.serviceList) {
          continue;
        }

        userCount++;

        for (var n = 0; service = _this.supportServiceList[n]; n++) {
          var userChannelList = chatItem.serviceList[service];
          if (!userChannelList) {
            continue;
          }

          channelList = top[service];
          if (channelList === undefined) {
            channelList = top[service] = {};
          }

          for (var i = 0; channelName = userChannelList[i]; i++) {
            if (channelList[channelName] === undefined) {
              channelList[channelName] = 0;
            }
            channelList[channelName]++;
          }
        }
      }

      var topArr = {};
      for (service in top) {
        channelList = top[service];

        channelCount += Object.keys(channelList).length;

        if (!topArr[service]) {
          topArr[service] = [];
        }

        for (channelName in channelList) {
          var count = channelList[channelName];
          topArr[service].push([channelName, count]);
        }
      }

      var textArr = [];

      textArr.push(_this.language.users.replace('{count}', userCount));
      textArr.push(_this.language.channels.replace('{count}', channelCount));

      for (service in topArr) {
        textArr.push('');
        textArr.push(_this.serviceToTitle[service] + ':');
        topArr[service].sort(function(a, b){return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1}).splice(10);
        topArr[service].map(function(item, index) {
          textArr.push((index + 1) + '. ' + item[0]);
        });
      }

      _this.bot.sendMessage(chatId, textArr.join('\n'));
    },
    livetime: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      var liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));

      var endTime = liveTime.endTime.split(',');
      endTime = (new Date(endTime[0], endTime[1], endTime[2])).getTime();
      var count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;

      var message = liveTime.message.join('\n').replace('{count}', count);

      _this.bot.sendMessage(chatId, message);
    }
  },
  checkArgs: function(msg, args) {
    "use strict";
    var chatId = msg.chat.id;

    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
      this.bot.sendMessage(chatId, this.language.channelNameIsEmpty, this.options.hideKeyboard);
      return;
    }

    channelName = channelName.toLowerCase();

    service = service || this.supportServiceList[0];
    service = service.toLowerCase();
    service = this.serviceMap[service] || service;

    if (this.supportServiceList.indexOf(service) === -1) {
      this.bot.sendMessage(
        chatId,
        this.language.serviceIsNotSupported
          .replace('{serviceName}', service),
        this.options.hideKeyboard
      );
      return;
    }

    args[0] = channelName;
    args[1] = service;

    return args;
  },
  getArgs: function(text) {
    "use strict";
    return text.split(/\s+/);
  },
  /**
   * @param {{chat: {id: Number}, [text]: String}} msg
   */
  onMessage: function(msg) {
    "use strict";
    debug(msg);

    var text = msg.text;
    var chatId = msg.chat.id;

    var responseFunc = this.stateList[chatId];
    if (responseFunc) {
      debug("Has response function!");
      delete this.stateList[chatId];
    }

    if (!text) {
      debug("Text is empty!");
      return;
    }

    if (text === 'Cancel') {
      text ='/cancel ' + (responseFunc && responseFunc.command || '');
    }

    if (text[0] !== '/') {
      if (responseFunc) {
        return responseFunc(msg);
      }

      debug("Msg is not command!", text);
      return;
    }

    text = text.substr(1);

    var args = this.getArgs(text);

    var action = args.shift().toLowerCase();
    var func = this.actionList[action];

    if (!func) {
      debug("Command is not found!", action);
      return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
      args = this.checkArgs(msg, args);
    }

    if (!args) {
      debug("Args is empty!");
      return;
    }

    debug("Run action", action, args);

    args.unshift(msg);

    func.apply(this.actionList, args);

    this.track(msg, action)
  },

  track: function(msg, title) {
    "use strict";
    try {
      botan.track({
        text: msg.text,
        from: {
          id: msg.from.id
        },
        chat: {
          id: msg.chat.id
        },
        date: msg.date
      }, title);
    } catch(e) {
      console.error(utils.getDate(), 'Botan track error', e.message);
    }
  },

  checker: {
    timer: null,

    getRunTime: function(interval) {
      var everyMs = interval * 60 * 1000;
      var today = new Date();
      var ms = today.getMilliseconds();
      var sec = today.getSeconds();
      var min = today.getMinutes();

      var nowMs = min * 60 * 1000 + sec * 1000 + ms;

      var waitMs = everyMs - nowMs % everyMs;

      return waitMs;
    },

    onTimer: function() {
      "use strict";
      checker.updateList();
    },

    run: function(now) {
      "use strict";
      var _this = this;

      if (now) {
        _this.onTimer();
      }

      setTimeout(function() {
        _this.stop();

        _this.timer = setInterval(function() {
          _this.onTimer();
        }, chat.storage.interval * 60 * 1000);

        _this.onTimer();
      }, _this.getRunTime(chat.storage.interval));
    },
    stop: function() {
      "use strict";
      clearInterval(this.timer);
    }
  },

  runDaemon: function() {
    "use strict";
    var _this = this;

    if (checker) {
      this.checker.run(1);
    }

    var hasGc = typeof gc === 'function';

    setInterval(function() {
      chat.clearStateList();

      if (_this.botPolling._polling.lastUpdate + 3600 * 2 * 1000 < Date.now()) {
        console.error(utils.getDate(), 'Polling restart!');
        _this.botPolling.initPolling();
      }

      hasGc && gc();
    }, 60 * 1000);
  },

  once: function() {
    "use strict";
    try {
      var language = JSON.parse(require("fs").readFileSync('./language.json', 'utf8'));
      for (var key in language) {
        var item = language[key];
        if (Array.isArray(item)) {
          item = item.join('\n');
        }
        this.language[key] = item;
      }
    } catch (e) {
      return console.error(utils.getDate(), "Language file is not found!", e.message);
    }

    try {
      var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    } catch (e) {
      return console.error(utils.getDate(), "Config is not found!", e.message);
    }

    services.youtube.init(config.ytToken);

    if (config.timeout < config.interval * 60 * 2) {
      config.timeout = parseInt(config.interval * 3 * 60);
      console.log(utils.getDate(), 'Timeout auto change!', config.timeout + 'sec.');
    }

    ['timeout', 'notifyTimeout', 'interval', 'token', 'botanToken'].forEach(function(key) {
      if (config.hasOwnProperty(key)) {
        this.storage[key] = config[key];
      }
    }.bind(this));

    utils.storage.get(['chatList', 'lastStreamList'], function(storage) {
      if (storage.chatList) {
        this.storage.chatList = storage.chatList;
      }
      if (storage.lastStreamList) {
        this.storage.lastStreamList = storage.lastStreamList;
      }

      this.bot = new TelegramBot(this.storage.token);
      this.botPolling = new botPolling(this.storage.token, {polling: {
        timeout: 3600
      }});
      this.botPolling.on('message', this.onMessage.bind(this));

      if (this.storage.botanToken) {
        botan = require('botanio')(this.storage.botanToken);
      } else {
        botan = {track: function(data, action){
          debug("Track", action, data);
        }};
      }

      checker = require('./checker.js');
      checker.init(this.storage, this.language, services, botan);

      this.runDaemon();
    }.bind(this));
  }
};

var botan = null;
var services = {};
chat.supportServiceList.forEach(function(service) {
  services[service] = require('./' + service);
});

chat.once();