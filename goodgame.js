/**
 * Created by anton on 19.07.15.
 */
var utils = require('./utils');
var convertGoodGameApi = function(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return;
    }
    var streams = [];
    for (var streamId in data) {
        var origItem = data[streamId];
        if (origItem.status !== 'Live') {
            continue;
        }
        var item = {
            _service: 'goodgame',
            _id: origItem.stream_id,
            game: origItem.games,
            preview: {
                template: origItem.thumb
            },
            created_at: undefined,
            channel: {
                display_name: undefined,
                name: origItem.key,
                status: origItem.title,
                logo: origItem.img,
                url: origItem.url
            }
        };
        streams.push(item);
    }
    return streams;
};
var getGoodGameStreamList = function(channelList, cb) {
    var params = {};
    params.id = channelList.join(',');
    utils.ajax({
        url: 'http://goodgame.ru/api/getchannelstatus?fmt=json&' + utils.param(params),
        dataType: 'json',
        success: function(data) {
            cb(convertGoodGameApi(data));
        }.bind(this),
        error: function() {
            cb();
        }
    });
};
module.exports = getGoodGameStreamList;