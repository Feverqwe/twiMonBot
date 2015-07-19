var Bot = function() {
  "use strict";
  this.base_url = 'https://api.telegram.org/bot';
  this.id = '';
  this.first_name = '';
  this.username = '';
  this.token = null;
  this.offset = 0;
  this.chat_id = undefined;
  this.user_id = -1;
  this.onMessage = function() {};
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
    error: function(xhr) {
      console.error(xhr.responseText);
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
    this.username  = data.result.username;

    cb && cb();
  }.bind(this))
};

Bot.prototype.sendMessage = function (options, cb) {
  this._get({
    method: 'sendMessage',
    params: {
      chat_id: options.chat_id,
      text: options.text,
      disable_web_page_preview: options.disable_web_page_preview,
      reply_to_message_id: options.reply_to_message_id,
      reply_markup: JSON.stringify(options.reply_markup)
    }
  }, function (data) {
    if (!data || !data.ok) {
      throw "sendMessage error!";
    }

    cb && cb();
  }.bind(this));
};

Bot.prototype.getUpdates = function(cb) {
  "use strict";
  this._get({
    method: 'getUpdates',
    params: {
      timeout: 60,
      offset: this.offset
    }
  }, function(data) {
    if (!data || !data.ok) {
      throw "getUpdates error!";
    }

    data.result.forEach(function (msg) {
      if (msg.update_id < this.offset) {
        return;
      }

      var message = msg.message;

      if (message.from.id === this.user_id) {
        this.chat_id = message.chat.id;
      }

      if (message.text) {
        this.onMessage(this.message.text, function(text) {
          this.sendMessage({
            chat_id: message.chat.id,
            reply_to_message_id: message.message_id,
            text: text
          });
        }.bind(this));
      }

      this.offset = msg.update_id + 1;
    }.bind(this));

    cb && cb();
  }.bind(this));
};
var utils = require('./utils');

module.exports = new Bot();