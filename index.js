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

      var userList = this.preferences.userList;
      for (var user_id in userList) {
        var user = userList[user_id];
        var userChannelList;
        if (!(userChannelList = user.serviceList[stream._service])) {
          continue;
        }
        if (userChannelList.indexOf(stream._channelName) !== -1) {
          bot.sendMessage({
            chat_id: user.chat_id,
            text: text
          });
        }
      }
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
  inProgress: false,
  updateList: function(cb) {
    "use strict";
    if (this.inProgress) {
      return console.error('Dbl update!');
    }
    this.inProgress = true;

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

      var now = parseInt(Date.now() / 1000);

      for (var i = 0, origItem; origItem = streamList[i]; i++) {
        var _id;
        var channelName = origItem.channel.name.toLowerCase();
        var newItem = {
          _service: origItem._service,
          _addItemTime: now,
          _id: _id = origItem._id,
          _isOffline: false,
          _channelName: channelName,

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

      utils.storage.set({lastStreamList: lastStreamList}, function() {
        this.inProgress = false;
        cb && cb();
      }.bind(this));
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

  interval: {
    timer: null,
    onTimer: function() {
      "use strict";
        engine.updateList();
    },
    run: function(now) {
      "use strict";
      this.stop();
      this.timer = setInterval(function(){
        engine.interval.onTimer();
      }, engine.preferences.interval * 60 * 1000);
      if (now) {
        this.onTimer();
      }
    },
    stop: function() {
      "use strict";
      clearInterval(this.timer);
    }
  },

  onGetUpdates: function() {
    utils.storage.set({
      offset: bot.offset || 0
    });

    engine.loop();
  },

  loop: function() {
    "use strict";
    gc();
    bot.getUpdates(3600 * 6, function() {
      engine.onGetUpdates();
    });
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

        this.interval.run(1);
        this.loop();

      }.bind(this));
    }.bind(this));
  }
};
var utils = require('./utils');
var bot = require('./bot');
var services = {};
['twitch', 'goodgame'].forEach(function(service) {
  services[service] = require('./'+service);
});

engine.once();