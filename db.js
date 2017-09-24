/**
 * Created by Anton on 19.02.2017.
 */
"use strict";
const debug = require('debug')('app:db');
const mysql = require('mysql');

var Db = function (options) {
    this.config = options.config.db;
    this.connection = null;

    this.onReady = this.init();
};

Db.prototype.init = function () {
    const self = this;
    self.connection = self.getPool();
    return self.getVersion();
};

Db.prototype.getConnection = function () {
    return mysql.createConnection({
        host: this.config.host,
        user: this.config.user,
        port: this.config.port,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4'
    });
};

Db.prototype.getPool = function (limit) {
    limit = limit || 1;
    return mysql.createPool({
        connectionLimit: limit,
        host: this.config.host,
        user: this.config.user,
        port: this.config.port,
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

Db.prototype.transaction = function (promise) {
    var _this = this;
    return _this.newConnection().then(function (connection) {
        return new Promise(function (resolve, reject) {
            connection.beginTransaction(function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(connection);
                }
            });
        }).then(promise).then(function () {
            return new Promise(function (resolve, reject) {
                connection.commit(function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        }).catch(function (err) {
            return new Promise(function (resolve) {
                connection.rollback(resolve);
            }).then(function () {
                throw err;
            });
        }).then(function (result) {
            connection.end();
            return result;
        }, function (err) {
            connection.end();
            throw err;
        });
    });
};

Db.prototype.getVersion = function () {
    const self = this;
    return new Promise(function (resove, reject) {
        self.connection.query('SELECT VERSION()', function (err, results) {
            err ? reject(err) : resove(results[0]['VERSION()']);
        });
    });
};

Db.prototype.wrapTableParams = function (table, params) {
    return params.map(function (param) {
        return [[table, param].join('.'), 'AS', [table, param].join('_DOT_')].join(' ')
    }).join(', ');
};

Db.prototype.unWrapTableParams = function (row) {
    const result = {};
    Object.keys(row).forEach(function (key) {
        const keyValue = /^(.+)_DOT_(.+)$/.exec(key);
        if (!keyValue) {
            result[key] = row[key];
        } else {
            let tableName = keyValue[1];
            let field = keyValue[2];
            let table = result[tableName];
            if (!table) {
                table = result[tableName] = {};
            }
            table[field] = row[key];
        }
    });
    return result;
};

module.exports = Db;