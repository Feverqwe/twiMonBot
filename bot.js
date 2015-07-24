var Bot = function() {
  "use strict";
  this.base_url = 'https://api.telegram.org/bot';
  this.id = '';
  this.first_name = '';
  this.username = '';
  this.token = null;
  this.offset = 0;
  this.onMessage = function() {
  };
  this.onReplyList = {};
};

Bot.prototype._get = function(options, cb) {
  "use strict";
  utils.ajax({
    type: 'POST',
    url: this.base_url + this.token + '/' + options.method,
    data: options.params,
    dataType: 'json',
    success: function(data) {
      cb(data);
    },
    error: function(responseText) {
      console.error(responseText);
      cb();
    }
  });
};

Bot.prototype.getMe = function(cb) {
  "use strict";
  this._get({method: 'getMe'}, function(data) {
    if (!data || data.ok) {
      throw "getMe error!";
    }

    this.id = data.result.id;
    this.first_name = data.result.first_name;
    this.username = data.result.username;

    cb && cb();
  }.bind(this))
};

Bot.prototype.sendMessage = function(options, cb) {
  this._get({
    method: 'sendMessage',
    params: {
      chat_id: options.chat_id,
      text: options.text,
      disable_web_page_preview: options.disable_web_page_preview,
      reply_to_message_id: options.reply_to_message_id,
      reply_markup: JSON.stringify(options.reply_markup)
    }
  }, function(data) {
    if (!data || !data.ok) {
      throw "sendMessage error!";
    }

    cb && cb(data);
  }.bind(this));
};

var replyFunc = function(message, text, options, onReply) {
  "use strict";
  var base = {
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    text: text
  };
  for (var key in options) {
    base[key] = options[key];
  }

  this.sendMessage(base, function(data) {
    if (!onReply) {
      return;
    }

    this.onReplyList[data.result.message_id] = {
      func: onReply,
      time: parseInt(Date.now() / 1000) + 300
    };
  }.bind(this));
};

var clearReplyList = function(list) {
  "use strict";
  var now = parseInt(Date.now() / 1000);

  var rmList = [];
  for (var id in list) {
    var item = list[id];
    if (item.time < now) {
      rmList.push(id);
    }
  }

  for (var i = 0, id; id = rmList[i]; i++) {
    delete list[id];
  }
};

Bot.prototype.getUpdates = function(cb, fail) {
  "use strict";
  this._get({
    method: 'getUpdates',
    params: {
      timeout: 3600,
      offset: this.offset
    }
  }, function(data) {
    if (!data || !data.ok) {
      console.error("getUpdates API error!");
      return fail();
    }

    data.result.forEach(function(msg) {
      if (msg.update_id < this.offset) {
        return;
      }
      this.offset = msg.update_id + 1;

      var message = msg.message;

      if (!message.text) {
        return;
      }

      if (message.reply_to_message) {
        clearReplyList(this.onReplyList);
        var id = message.reply_to_message.message_id;
        var obj = this.onReplyList[id];
        delete this.onReplyList[id];

        if (obj) {
          obj.func({
            user_id: message.from.id,
            chat_id: message.chat.id
          }, message.text, replyFunc.bind(this, message));
        }
        return;
      }

      if (message.text) {
        this.onMessage({
          user_id: message.from.id,
          chat_id: message.chat.id
        }, message.text, replyFunc.bind(this, message));
      }
    }.bind(this));

    cb && cb();
  }.bind(this));
};
var utils = require('./utils');

module.exports = new Bot();