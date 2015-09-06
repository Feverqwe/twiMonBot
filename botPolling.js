/**
 * Created by Anton on 05.09.2015.
 */
var debug = require('debug')('botPolling');
var Promise = require("bluebird");
var request = require('request');
var URL = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var requestPromise = Promise.promisify(request);

var TelegramBot = function (token, options) {
  options = options || {};
  this.options = options;
  this.token = token;
  this.messageTypes = [
    'text', 'audio', 'document', 'photo', 'sticker', 'video', 'contact',
    'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
    'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
  ]; // Telegram message events

  this.processUpdate = this._processUpdate.bind(this);

  if (options.polling) {
    this.initPolling();
  }
};

util.inherits(TelegramBot, EventEmitter);

TelegramBot.prototype.initPolling = function() {
  var index = 0;
  var offset = 0;
  if (this._polling) {
    this._polling.abort = true;
    this._polling.lastRequest.cancel("Polling restart");
    offset = this._polling.offset;
    index = this._polling.index + 1;
  }
  this._polling = new TelegramBotPolling(this.token, this.options.polling, this.processUpdate);
  this._polling.index = index;
  this._polling.offset = offset;
  this._polling._polling();
};

TelegramBot.prototype._processUpdate = function (update) {
  debug('Process Update %j', update);
  var message = update.message;
  debug('Process Update message %j', message);
  if (message) {
    this.emit('message', message);
    var processMessageType = function (messageType) {
      if (message[messageType]) {
        debug('Emtting %s: %j', messageType, message);
        this.emit(messageType, message);
      }
    };
    this.messageTypes.forEach(processMessageType.bind(this));
  }
};

var TelegramBotPolling = function (token, options, callback) {
  options = options || {};
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  this.offset = 0;
  this.abort = false;
  this.token = token;
  this.index = 0;
  this.callback = callback;
  this.timeout = options.timeout || 0;
  this.interval = options.interval || 2000;
  this.lastUpdate = Date.now();
  this.lastRequest = null;
};

TelegramBotPolling.prototype._polling = function () {
  var self = this;
  this.lastRequest = this._getUpdates().then(function (updates) {
    self.lastUpdate = Date.now();

    debug('#' + self.index, 'polling data', updates);
    updates.forEach(function (update, index) {
      // If is the latest, update the offset.
      if (index === updates.length - 1) {
        self.offset = update.update_id;
        debug('#' + self.index, 'updated offset:', self.offset);
      }
      self.callback(update);
    });
  }).catch(function (err) {
    debug('#' + self.index, 'polling error:', err);
  }).finally(function () {
    if (self.abort) {
      console.error('Polling is aborted!', self.index);
      return;
    }

    debug('#' + self.index, 'setTimeout for miliseconds', self.interval);
    setTimeout(self._polling.bind(self), self.interval);
  });
};

TelegramBotPolling.prototype._getUpdates = function () {
  var opts = {
    qs: {
      offset: this.offset+1,
      limit: this.limit,
      timeout: this.timeout
    },
    url: URL.format({
      protocol: 'https',
      host: 'api.telegram.org',
      pathname: '/bot'+this.token+'/getUpdates'
    })
  };
  debug('#' + this.index, 'polling with options:', opts);
  return requestPromise(opts).cancellable().then(function (resp) {
    if (resp[0].statusCode !== 200) {
      throw new Error(resp[0].statusCode+' '+resp[0].body);
    }
    var data = JSON.parse(resp[0].body);
    if (data.ok) {
      return data.result;
    } else {
      throw new Error(data.error_code+' '+data.description);
    }
  });
};

module.exports = TelegramBot;