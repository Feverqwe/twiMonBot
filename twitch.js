/**
 * Created by anton on 19.07.15.
 */
var utils = require('./utils');
var getTwitchStreamList = function(channelList, cb) {
    var params = {};
    params.channel = channelList.join(',');
    utils.ajax({
        url: 'https://api.twitch.tv/kraken/streams?' + utils.param(params),
        dataType: 'json',
        success: function(data) {
            var streams = data && data.streams || [];
            for (var i = 0, item; item = streams[i]; i++) {
                item._service = 'twitch';
            }
            cb(streams);
        },
        error: function() {
            cb();
        }
    });
};
module.exports = getTwitchStreamList;