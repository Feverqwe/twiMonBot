/**
 * Created by Anton on 19.07.2015.
 */
var engine = {
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

  actionList: {
    ping: function(meta, response) {
      "use strict";
      response("pong");
    },
    start: function(meta, response) {
      "use strict";
      response("Hello!");
    },
    help: function(meta, response) {
      "use strict";
      var help = ["Hello user!"];
      help.push('Note: <channelName> - Channel name');
      help.push('Note: <serviceName> - Service name, twitch or goodgame, default twitch');
      help.push('/a <channelName> <serviceName> - Add channel in list');
      help.push('/d <channelName> <serviceName> - Delete channel from list');
      help.push('/l - Show list of channel');
      help.push('/o - Online channel list');
      help.push('/c - Clean channel list');
      response(help.join('\n'));
    },
    a: function(meta, response, channelName, service) {
      "use strict";
      if (!channelName) {
        return response('Error! Bad channel name!');
      }
      channelName = channelName.toLowerCase();

      service = service || 'twitch';
      service = service.toLowerCase();
      if (['twitch', 'goodgame'].indexOf(service) === -1) {
        return response('Error! Service ' + service + ' is not supported!');
      }

      var userList = engine.preferences.userList;

      var user = userList[meta.user_id] = userList[meta.user_id] || {};
      user.chat_id = meta.chat_id;
      user.serviceList = user.serviceList || {};
      user.serviceList[service] = user.serviceList[service] || [];

      if (user.serviceList[service].indexOf(channelName) !== -1) {
        return response("Channel exists!");
      }

      user.serviceList[service].push(channelName);

      utils.storage.set({userList: userList}, function() {
        response("Add channel " + channelName + " to " + service);
      });
    },
    d: function(meta, response, channelName, service) {
      "use strict";
      if (!channelName) {
        return response('Error! Bad channel name!');
      }
      channelName = channelName.toLowerCase();

      service = service || 'twitch';
      service = service.toLowerCase();
      if (['twitch', 'goodgame'].indexOf(service) === -1) {
        return response('Error! Service ' + service + ' is not supported!');
      }

      var userList = engine.preferences.userList;

      var user;
      if (!(user = userList[meta.user_id]) || !user.serviceList[service]) {
        return response("Error user or service is not found!");
      }

      var pos = user.serviceList[service].indexOf(channelName);
      if (pos === -1) {
        return response("Error channel is not found!");
      }

      user.serviceList[service].splice(pos, 1);

      if (user.serviceList[service].length === 0) {
        delete user.serviceList[service];

        if (Object.keys(user.serviceList).length === 0) {
          delete userList[meta.user_id];
        }
      }

      utils.storage.set({userList: userList}, function() {
        response("Delete channel " + channelName + " from " + service);
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
        response("Channel list is clear!");
      });
    },
    l: function(meta, response) {
      "use strict";
      var userList = engine.preferences.userList;
      var user;
      if (!(user = userList[meta.user_id])) {
        return response("Channels is not found!");
      }

      var serviceList = ['Channel list'];
      for (var service in user.serviceList) {
        serviceList.push(service + ': ' + user.serviceList[service].join(', '));
      }

      response(serviceList.join('\n'));
    },
    o: function(meta, response) {
      "use strict";
      var lastStreamList = engine.preferences.lastStreamList;
      var userList = engine.preferences.userList;
      var user;
      if (!(user = userList[meta.user_id])) {
        return response("Channels is not found!");
      }

      var onLineList = [];

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
        onLineList.unshift('Offline');
      }

      response(onLineList.join('\n'));
    }
  },

  actionRegexp: /^\/([^\s\t]+)[\s\t]*([^\s\t]+)?[\s\t]*([^\s\t]+)?.*/,

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

    m.unshift(response);
    m.unshift(meta);

    func && func.apply(this.actionList, m);
  },

  loop: function() {
    "use strict";
    gc();
    bot.getUpdates(function() {
      setTimeout(function() {
        // async offset write
        utils.storage.set({
          offset: bot.offset || 0
        });
      });

      this.loop();
    }.bind(this));
  },

  once: function() {
    "use strict";
    var config = JSON.parse(require("fs").readFileSync('./config.json', 'utf8'));
    bot.token = config.token;
    this.defaultPreferences = config.defaultPreferences;

    utils.storage.get(['offset'], function(storage) {
      bot.offset = storage.offset || 0;
      bot.onMessage = this.onMessage.bind(this);

      this.loadSettings(function() {

        this.loop();

      }.bind(this));
    }.bind(this));
  }
};
var utils = require('./utils');
var bot = require('./bot');

engine.once();