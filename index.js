/**
 * Created by Anton on 19.07.2015.
 */
var engine = {
  defaultPreferences: {
    userList: {},
    lastStreamList: {},
    interval: 1,
    timeout: 300,
    includeChecker: true
  },
  preferences: {},
  serviceMap: {
    gg: 'goodgame',
    tw: 'twitch'
  },
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
        this.preferences.timeout = parseInt(this.preferences.interval * 3 * 60);
        console.log('Timeout auto change!', this.preferences.timeout + 'sec.');
      }

      cb();
    }.bind(this));
  },

  getLastStreamList: function(cb) {
    "use strict";
    if (this.preferences.includeChecker) {
      return cb();
    }
    utils.storage.get('lastStreamList', function(storage) {
      this.preferences.lastStreamList = storage.lastStreamList;
      cb();
    }.bind(this));
  },

  actionList: {
    ping: function(meta, response) {
      "use strict";
      response("pong");
    },
    start: function(meta, response) {
      "use strict";
      response("Hi!");
    },
    help: function(meta, response) {
      "use strict";
      var help = ["Hello user!"];
      help.push('/add - Add channel in list');
      help.push('/delete - Delete channel from list');
      help.push('/o - Online channel list');
      help.push('/l - Show list of channel');
      help.push('/c - Clean channel list');
      response(help.join('\n'));
    },
    add: function(meta, response) {
      "use strict";
      var channelName;
      var service;
      response('Enter channel name', {
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }, function(meta, text, response) {
        channelName = text;
        response('Enter service twitch or goodgame', {
          reply_markup: {
            force_reply: true,
            selective: true
          }
        },
        function(meta, text, response) {
          service = text;

          engine.actionList.a(meta, response, channelName, service);
        });
      });
    },
    a: function(meta, response, channelName, service) {
      "use strict";
      var userList = engine.preferences.userList;

      var user = userList[meta.user_id] = userList[meta.user_id] || {};
      user.chat_id = meta.chat_id;
      user.serviceList = user.serviceList || {};
      user.serviceList[service] = user.serviceList[service] || [];

      if (user.serviceList[service].indexOf(channelName) !== -1) {
        return response("Channel already exists!");
      }

      user.serviceList[service].push(channelName);

      utils.storage.set({userList: userList}, function() {
        response("Channel " + channelName + " (" + service + ") added!");
      });
    },
    delete: function(meta, response) {
      "use strict";
      var userList = engine.preferences.userList;

      var user = userList[meta.user_id];
      if (!user) {
        return response("User is not found!");
      }

      var btnList = [];
      for (var service in user.serviceList) {
        var channelList = user.serviceList[service];
        for (var i = 0, channelName; channelName = channelList[i]; i++) {
          btnList.push(['/d ' + channelName + ' ' + service]);
        }
      }
      btnList.push(['/cancel']);


      response('Select the channel that you want to delete', {
        reply_markup: {
          keyboard: btnList,
          resize_keyboard: true,
          one_time_keyboard: true,
          selective: true
        }
      });
    },
    cancel: function(meta, response) {
      "use strict";
      response('The command has been cancelled.');
    },
    d: function(meta, response, channelName, service) {
      "use strict";
      var userList = engine.preferences.userList;

      var user;
      if (!(user = userList[meta.user_id]) || !user.serviceList[service]) {
        return response("User or service is not found!");
      }

      var pos = user.serviceList[service].indexOf(channelName);
      if (pos === -1) {
        return response("Channel is not found!");
      }

      user.serviceList[service].splice(pos, 1);

      if (user.serviceList[service].length === 0) {
        delete user.serviceList[service];

        if (Object.keys(user.serviceList).length === 0) {
          delete userList[meta.user_id];
        }
      }

      utils.storage.set({userList: userList}, function() {
        response("Channel " + channelName + " (" + service + ") deleted!");
      });
    },
    c: function(meta, response) {
      "use strict";
      var userList = engine.preferences.userList;
      if (!userList[meta.user_id]) {
        return response("User is not found!");
      }

      delete userList[meta.user_id];

      utils.storage.set({userList: userList}, function() {
        response("Channel list is cleared!");
      });
    },
    l: function(meta, response) {
      "use strict";
      var userList = engine.preferences.userList;
      var user;
      if (!(user = userList[meta.user_id])) {
        return response("User is not found!");
      }

      var serviceList = ['Channel list:'];
      for (var service in user.serviceList) {
        serviceList.push(service + ': ' + user.serviceList[service].join(', '));
      }

      response(serviceList.join('\n'));
    },
    o: function(meta, response) {
      "use strict";
      var userList = engine.preferences.userList;
      var user;
      if (!(user = userList[meta.user_id])) {
        return response("User is not found!");
      }

      var onLineList = [];

      engine.getLastStreamList(function() {
        var lastStreamList = engine.preferences.lastStreamList;

        for (var service in user.serviceList) {
          var userChannelList = user.serviceList[service];

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
          onLineList.unshift('Now online:');
        } else {
          onLineList.unshift('All channels in offline');
        }

        response(onLineList.join('\n'));
      });
    }
  },

  actionRegexp: /^\/([^\s\t]+)[\s\t]*([^\s\t]+)?[\s\t]*([^\s\t]+)?.*/,

  checkArgs: function(args, response) {
    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
      response('Oops! Channel name is empty!');
      return;
    }

    channelName = channelName.toLowerCase();

    service = service || this.supportServiceList[0];
    service = service.toLowerCase();
    service = this.serviceMap[service] || service;

    if (this.supportServiceList.indexOf(service) === -1) {
      response('Oops! Service ' + service + ' is not supported!');
      return;
    }

    args[0] = channelName;
    args[1] = service;

    return args;
  },

  onMessage: function(meta, text, response) {
    text = text.trim();
    var m = text.match(this.actionRegexp);
    if (!m) {
      return;
    }
    m.shift();
    m.splice(3);

    var action = m.shift().toLowerCase();
    var func = this.actionList[action];

    if (!func) {
      return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
      m = this.checkArgs(m, response);

      if (!m) {
        return;
      }
    }

    m.unshift(response);
    m.unshift(meta);

    func.apply(this.actionList, m);
  },

  checker: {
    timer: null,
    onTimer: function() {
      "use strict";
      gc();
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
      }, engine.preferences.interval * 60 * 1000);
    },
    stop: function() {
      "use strict";
      clearInterval(this.timer);
    }
  },

  chat: {
    isFail: false,
    update: function() {
      "use strict";
      gc();
      var _this = this;
      _this.isFail = false;
      bot.getUpdates(function() {
        setTimeout(function() {
          // async offset write
          utils.storage.set({
            offset: bot.offset || 0
          });
        });

        _this.update();
      }, function() {
        _this.isFail = true;
      });
    }
  },

  runDaemon: function() {
    "use strict";
    var self = engine;

    if (checker) {
      self.checker.run(1);
    }

    setInterval(function() {
      if (self.chat.isFail) {
        self.chat.update();
      }
    }, 60 * 1000);

    self.chat.update();
  },

  loadConfig: function() {
    var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    bot.token = config.token;
    this.defaultPreferences = config.defaultPreferences;
  },

  once: function() {
    "use strict";
    this.loadConfig();

    utils.storage.get(['offset'], function(storage) {
      bot.offset = storage.offset || 0;
      bot.onMessage = this.onMessage.bind(this);

      this.loadSettings(function() {
        if (this.preferences.includeChecker) {
          checker = require('./checker.js');
          checker.init(this.preferences);
        }

        this.runDaemon();

      }.bind(this));
    }.bind(this));
  }
};
var checker = null;
var utils = require('./utils');
var bot = require('./bot');

engine.once();