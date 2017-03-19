/**
 * Created by Anton on 19.03.2017.
 */
"use strict";
var debug = require('debug')('app:service');

var Service = function () {

};

/**
 * @typedef {{}} ChannelInfo
 * @property {String} id
 * @property {String} title
 */

/**
 * @private
 * @param {String[]} channelIds
 * @return {Promise}
 */
Service.prototype.getChannelsInfo = function (channelIds) {
    var _this = this;
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        if (!channelIds.length) {
            return resolve([]);
        }

        db.connection.query('\
            SELECT * FROM ' + _this.dbTable + ' WHERE id IN ?; \
        ', [[channelIds]], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    }).catch(function (err) {
        debug('getChannelsInfo', err);
        return [];
    });
};

/**
 * @param {ChannelInfo} info
 * @return {String}
 */
Service.prototype.getChannelTitleFromInfo = function (info) {
    return info.title || info.id;
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Service.prototype.getChannelTitle = function (channelId) {
    var _this = this;
    return this.getChannelsInfo([channelId]).then(function (infoList) {
        var info = infoList[0] || {};
        return _this.getChannelTitleFromInfo(info) || channelId;
    });
};

/**
 * @param {Object} info
 * @return {Promise}
 */
Service.prototype.setChannelInfo = function(info) {
    var _this = this;
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO ' + _this.dbTable + ' SET ? ON DUPLICATE KEY UPDATE ? \
        ', [info, info], function (err, results) {
            if (err) {
                debug('setChannelInfo', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

module.exports = Service;