/**
 * Created by Anton on 19.07.2015.
 */
var checker = null;
var utils = require('./utils');
var TelegramBot = require('node-telegram-bot-api');
var debug = require('debug')('chat');
var chat = {
  storage: {
    token: null,
    interval: 5,
    timeout: 900,
    includeChecker: true,
    chatList: {},
    lastStreamList: {}
  },
  stateList: {},
  supportServiceList: ['twitch', 'goodgame'],
  bot: null,
  serviceMap: {
    gg: 'goodgame',
    tw: 'twitch'
  },
  language: {
    help: "{help msg",
    online: "{online msg}",
    offline: "{offline msg}",
    emptyServiceList: "{empty service list msg}",
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
    channelNameIsEmpty: "{channelNameIsEmpty}"
  },
  options: {
    hideKeyboard: {
      reply_markup: {
        hide_keyboard: true,
        selective: true
      }
    }
  },

  getLastStreamList: function(cb) {
    "use strict";
    if (this.storage.includeChecker) {
      return cb();
    }
    utils.storage.get('lastStreamList', function(storage) {
      this.storage.lastStreamList = storage.lastStreamList;
      cb();
    }.bind(this));
  },
  onResponse: function(state, data, msg) {
    "use strict";
    var chatId = msg.chat.id;

    if (state === 'channelName') {
      data.push(msg.text);
      this.stateList[chatId] = this.onResponse(this, 'service', data);
      this.stateList[chatId].command = 'add';

      var btnList = [];
      for (var i = 0, service; service = this.supportServiceList[i]; i++) {
        btnList.push(service);
      }
      btnList.push('Cancel');

      this.bot.sendMessage(chatId, this.language.enterService, {
        reply_markup: {
          keyboard: btnList,
          resize_keyboard: true,
          one_time_keyboard: true,
          selective: true
        }
      });
    }

    if (state === 'service') {
      data.push(msg.text);
      msg.text = '/a ' + data.join(' ');
      this.onMessage(msg);
    }

    if (state === 'delete') {
      data = msg.text.match(/^(.+) \((.+)\)$/);
      if (!data) {
        return;
      }
      data.shift();

      msg.text = '/d ' + data.join(' ');
      this.onMessage(msg);
    }
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

      var chatItem = chatList[chatId] = chatList[chatId] || {};
      chatItem.chatId = chatId;

      var serviceList = chatItem.serviceList = chatItem.serviceList || {};
      var channelList = serviceList[service] = serviceList[service] || [];

      if (channelList.indexOf(channelName) !== -1) {
        return _this.bot.sendMessage(chatId, _this.language.channelExists, _this.options.hideKeyboard);
      }

      channelList.push(channelName);

      utils.storage.set({chatList: chatList}, function() {
        return _this.bot.sendMessage(
          chatId,
          _this.language.channelAdded
            .replace('{channelName}', channelName)
            .replace('{serviceName}', service),
          _this.options.hideKeyboard
        );
      });
    },
    add: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.stateList[chatId] = _this.onResponse.bind(_this, 'channelName', []);
      _this.stateList[chatId].command = 'add';

      _this.bot.sendMessage(
        chatId,
        _this.language.enterChannelName,
        {reply_markup: {
          force_reply: true,
          selective: true
        }}
      );
    },
    d: function(msg, channelName, service) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[service];

      if (!channelList) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      var pos = channelList.indexOf(channelName);
      if (pos === -1) {
        return _this.bot.sendMessage(chatId, _this.language.channelDontExist);
      }

      channelList.splice(pos, 1);

      utils.storage.set({chatList: chatList}, function() {
        return _this.bot.sendMessage(
          chatId,
          _this.language.channelDeleted
            .replace('{channelName}', channelName)
            .replace('{serviceName}', service),
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
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      _this.stateList[chatId] = _this.onResponse.bind(_this, 'delete', []);
      _this.stateList[chatId].command = 'delete';

      var btnList = [];
      for (var service in chatItem.serviceList) {
        var channelList = chatItem.serviceList[service];
        for (var i = 0, channelName; channelName = channelList[i]; i++) {
          btnList.push(channelName + ' (' + service + ')');
        }
      }
      btnList.push(['Cancel']);

      this.bot.sendMessage(chatId, this.language.enterService, {
        reply_markup: {
          keyboard: btnList,
          resize_keyboard: true,
          one_time_keyboard: true,
          selective: true
        }
      });
    },
    cancel: function(msg, arg1) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;

      _this.bot.sendMessage(
        chatId,
        _this.language.commandCanceled
          .replace('{command}', arg1),
        _this.options.hideKeyboard
      );
    },
    clear: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      delete _this.storage.chatList[chatId];

      _this.bot.sendMessage(
        chatId,
        _this.language.cleared
      );
    },
    list: function(msg) {
      "use strict";
      var _this = chat;
      var chatId = msg.chat.id;
      var chatItem = _this.storage.chatList[chatId];

      if (!chatItem) {
        return _this.bot.sendMessage(chatId, _this.language.emptyServiceList);
      }

      var serviceList = [_this.language.channelList];
      for (var service in chatItem.serviceList) {
        serviceList.push(service + ': ' + chatItem.serviceList[service].join(', '));
      }

      _this.bot.sendMessage(
        chatId,
        serviceList.join('\n')
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
      _this.getLastStreamList(function() {
        var lastStreamList = _this.storage.lastStreamList;

        for (var service in chatItem.serviceList) {
          var userChannelList = chatItem.serviceList[service];

          var channelList = [];

          for (var id in lastStreamList) {
            var stream = lastStreamList[id];
            if (stream._isOffline || stream._service !== service) {
              continue;
            }

            if (userChannelList.indexOf(stream._channelName) !== -1) {
              channelList.push(stream._channelName);
            }
          }

          channelList.length && onLineList.push(service + ': ' + channelList.join(', '));
        }

        if (onLineList.length) {
          onLineList.unshift(_this.language.online);
        } else {
          onLineList.unshift(_this.language.offline);
        }

        _this.bot.sendMessage(chatId, onLineList.join('\n'));
      });
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
      delete this.stateList[chatId];
    }

    if (!text) {
      return;
    }

    if (responseFunc) {
      if (text === 'Cancel') {
        text = '/' + text + ' ' + responseFunc.command;
      } else {
        return responseFunc(msg);
      }
    }

    if (text[0] !== '/') {
      return;
    }

    text = text.substr(1);

    var args = text.split(/\s+/);

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
      return;
    }

    args.unshift(msg);

    func.apply(this.actionList, args);
  },

  checker: {
    timer: null,

    onTimer: function() {
      "use strict";
      checker.updateList();
    },

    run: function(now) {
      "use strict";
      var _this = this;

      _this.stop();

      if (now) {
        _this.onTimer();
      }

      _this.timer = setInterval(function() {
        _this.onTimer();
      }, chat.storage.interval * 60 * 1000);
    },
    stop: function() {
      "use strict";
      clearInterval(this.timer);
    }
  },

  runDaemon: function() {
    "use strict";

    if (checker) {
      this.checker.run(1);
    }

    var hasGc = typeof gc === 'function';

    setInterval(function() {
      hasGc && gc();
    }, 60 * 1000);
  },

  once: function() {
    "use strict";
    try {
      var language = JSON.parse(require("fs").readFileSync('./language.json', 'utf8'));
      for (var key in language) {
        if (Array.isArray(language[key])) {
          language[key] = language[key].join('\n');
        }
        this.language[key] = language[key];
      }
    } catch (e) {
      return console.error("Language file is not found!");
    }

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
    this.storage.interval = config.interval;
    this.storage.token = config.token;
    this.storage.includeChecker = config.includeChecker;

    utils.storage.get(['chatList', 'lastStreamList', 'userList'], function(storage) {
      if (storage.userList && !storage.chatList) {
        storage.chatList = {};
        for (var userId in storage.userList) {
          var userItem = storage.userList[userId];
          if (!userItem.serviceList || Object.keys(userItem.serviceList).length === 0) {
            continue;
          }
          storage.chatList[userItem.chat_id] = {
            chatId: userItem.chat_id,
            serviceList: userItem.serviceList
          }
        }
        utils.storage.set({chatList: storage.chatList}, function() {
          utils.storage.remove('userList');
        });
      }

      if (storage.chatList) {
        this.storage.chatList = storage.chatList;
      }
      if (storage.lastStreamList) {
        this.storage.lastStreamList = storage.lastStreamList;
      }

      this.bot = new TelegramBot(this.storage.token, {polling: {
        timeout: 60
      }});
      this.bot.on('message', this.onMessage.bind(this));

      if (this.storage.includeChecker) {
        checker = require('./checker.js');
        checker.init(this.storage);
      }

      this.runDaemon();
    }.bind(this));
  }
};

chat.once();