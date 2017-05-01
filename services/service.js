/**
 * Created by Anton on 19.03.2017.
 */
"use strict";
const debug = require('debug')('app:service');

var Service = function () {

};

Service.prototype.super = function (options) {
    this.gOptions = options;
    this.channels = options.channels;
};

module.exports = Service;