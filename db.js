/**
 * Created by Anton on 19.02.2017.
 */
"use strict";
var debug = require('debug')('app:db');
var mysql = require('mysql');

var Db = function (options) {
    this.config = options.config.db;
    this.connection = null;

    this.onReady = this.init();
};

Db.prototype.init = function () {
    "use strict";
    var connection = this.connection = this.getConnection();

    return new Promise(function (resolve, reject) {
        connection.connect(function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Db.prototype.getPool = function () {
    return mysql.createPool({
        connectionLimit : 10,
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4'
    });
};

Db.prototype.getConnection = function () {
    return mysql.createConnection({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4'
    });
};

Db.prototype.newConnection = function () {
    var connection = this.getConnection();

    return new Promise(function (resolve, reject) {
        connection.connect(function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(connection);
            }
        });
    });
};

module.exports = Db;