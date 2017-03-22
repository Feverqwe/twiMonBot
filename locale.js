/**
 * Created by Anton on 24.02.2017.
 */
"use strict";
var Locale = function (options) {
    this.gOptions = options;
    this.language = this.default;
    this.onReady = this.init();
};

Locale.prototype.default = {
    "help": "Hi! I will notify you about the beginning of the broadcasts on Youtube Gaming, Twitch, Hitbox and GoodGame!",
    "offline": "All channels in offline",
    "emptyServiceList": "You don't have channels in watch list, yet.",
    "enterChannelName": "Enter the channel URL or name (example: blackufa_twitch):",
    "enterService": "Enter a live streaming video platform",
    "serviceIsNotSupported": "Oops! Platform {serviceName} is not supported!",
    "channelExists": "This channel already exists!",
    "channelAdded": "Success! Channel {channelName} ({serviceName}) added!",
    "telegramChannelEnter": "Enter the channel name (example: @telegram):",
    "telegramChannelSet": "Success! The channel {channelName} has been assigned!",
    "telegramChannelError": "Oops! I can't add a {channelName} channel!",
    "commandCanceled": "The command {command} has been cancelled.",
    "channelDontExist": "Oops! Can't find channel in watch list!",
    "channelDeleted": "Success! Channel {channelName} ({serviceName}) deleted!",
    "cleared": "Success! The channel list has been cleared.",
    "channelNameIsEmpty": "Oops! Channel name is empty!",
    "selectDelChannel": "Select the channel that you want to delete",
    "channelIsNotFound": "Oops! Channel {channelName} ({serviceName}) is not found!",
    "clearSure": "Are you sure?",
    "streamIsNotFound": "Oops! Stream is not found!",
    "users": "Users: {count}",
    "channels": "Channels: {count}",
    "preview": "preview",
    "refresh": "Refresh",
    "online": "Online: {count}",
    "rateMe": [
        "", "",
        "⭐️ If you like this bot, please rate us 5 stars in store:",
        "https://telegram.me/storebot?start=twimonbot"
    ],
    "groupNote": ["", "Note for groups: Use \"Reply\" to send a answer."]
};

Locale.prototype.init = function () {
    var _this = this;
    return Promise.resolve().then(function () {
        Object.keys(_this.language).forEach(function (key) {
            var line = _this.language[key];
            if (Array.isArray(line)) {
                line = line.join('\n');
            }
            _this.language[key] = line;
        });
    });
};

module.exports = Locale;