/**
 * Created by anton on 19.07.15.
 */
var utils = require('./utils');
var getTwitchStreamList = function(data, cb) {
    utils.ajax({
        url: 'https://api.twitch.tv/kraken/streams?' + utils.param(data),
        dataType: 'json',
        success: function(data) {
            cb(data);
        },
        error: function() {
            cb();
        }
    });
};
module.exports = getTwitchStreamList;