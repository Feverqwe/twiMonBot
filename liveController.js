"use strict";
const debug = require('debug')('app:liveController');
const debugLog = require('debug')('app:liveController:log');
debugLog.log = console.log.bind(console);
const base = require('./base');

var LiveController = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
};

var insertPool = new base.Pool(15);

LiveController.prototype.findPrevStreamId = function (prevStreams, stream) {
    var prevStreamId = null;
    var data = JSON.parse(stream.data);
    prevStreams.some(function (prevStream) {
        var prevData = JSON.parse(prevStream.data);
        if (prevData.channel.status === data.channel.status &&
            prevData.channel.game === data.channel.game
        ) {
            prevStreamId = prevStream.id;
            return true;
        }
    });
    return prevStreamId;
};

LiveController.prototype.insertStreams = function (streams, channelList, serviceName) {
    var _this = this;
    const TIMEOUT = this.gOptions.config.timeout;
    return _this.gOptions.msgStack.getStreams(channelList, serviceName).then(function (prevStreams) {
        var streamIdPrevStreamMap = {};
        var channelIdPrevStreams = {};
        var prevStreamIds = [];
        prevStreams.forEach(function (prevStream) {
            prevStreamIds.push(prevStream.id);
            streamIdPrevStreamMap[prevStream.id] = prevStream;
            var channelStreams = channelIdPrevStreams[prevStream.channelId];
            if (!channelStreams) {
                channelStreams = channelIdPrevStreams[prevStream.channelId] = [];
            }
            channelStreams.push(prevStream);
        });

        var rmStream = function (stream, channelStreams) {
            delete streamIdPrevStreamMap[stream.id];

            var pos = prevStreamIds.indexOf(stream.id);
            if (pos !== -1) {
                prevStreamIds.splice(pos, 1);
            }

            pos = channelStreams.indexOf(stream);
            if (pos !== -1) {
                channelStreams.splice(pos, 1);
            }
        };

        var migrateStreamIds = [];
        var newStreams = [];
        var updateStreams = [];
        var offlineStreams = [];
        var timeoutStreams = [];
        var syncStreams = [];
        var removeStreamIds = [];
        streams.forEach(function (stream) {
            var prevChannelStreams = channelIdPrevStreams[stream.channelId] || [];

            if (stream.isTimeout) {
                prevChannelStreams.slice(0).forEach(function (prevStream) {
                    rmStream(prevStream, prevChannelStreams);

                    prevStream.checkTime = base.getNow();
                    if (!prevStream.isTimeout) {
                        prevStream.isTimeout = 1;
                        debugLog('Timeout (U) %s %j', prevStream.id, prevStream);
                        timeoutStreams.push(prevStream);
                    } else {
                        syncStreams.push(prevStream);
                    }
                });
                return;
            }

            var prevStream = streamIdPrevStreamMap[stream.id];
            if (prevStream) {
                rmStream(prevStream, prevChannelStreams);

                stream.imageFileId = null;

                var prevData = JSON.parse(prevStream.data);
                var data = JSON.parse(stream.data);

                if (prevStream.isOffline !== stream.isOffline ||
                    prevStream.isTimeout !== stream.isTimeout
                ) {
                    debugLog('Online (U) %s %j', stream.id, stream);
                    updateStreams.push(stream);
                } else
                if (prevData.channel.game !== data.channel.game ||
                    prevData.channel.status !== data.channel.status
                ) {
                    debugLog('Changes (U) %s %j', stream.id, stream);
                    updateStreams.push(stream);
                } else {
                    syncStreams.push(stream);
                }
                return;
            }

            if (!prevChannelStreams.length) {
                debugLog('New (N) %s %j', stream.id, stream);
                newStreams.push(stream);
                return;
            }

            var prevStreamId = _this.findPrevStreamId(prevChannelStreams, stream);
            prevStream = streamIdPrevStreamMap[prevStreamId];
            if (prevStream) {
                rmStream(prevStream, prevChannelStreams);

                migrateStreamIds.push([prevStream.id, stream.id]);

                stream.imageFileId = null;

                if (prevStream.isOffline !== stream.isOffline ||
                    prevStream.isTimeout !== stream.isTimeout
                ) {
                    debugLog('Online dbl (U) %s %j', stream.id, stream);
                    updateStreams.push(stream);
                } else {
                    debugLog('Dbl %s %j', stream.id, stream);
                    syncStreams.push(stream);
                }
                return;
            }

            debugLog('Dbl (N) %s %j', stream.id, stream);
            newStreams.push(stream);
        });
        prevStreamIds.forEach(function (id) {
            var stream = streamIdPrevStreamMap[id];
            stream.checkTime = base.getNow();
            if (!stream.isOffline) {
                stream.isOffline = 1;
                stream.isTimeout = 0;
                stream.offlineTime = base.getNow();
                debugLog('Offline (U) %s %j', stream.id, stream);
                offlineStreams.push(stream);
            } else
            if (base.getNow() - stream.offlineTime > TIMEOUT) {
                debugLog('Remove %s %j', stream.id, stream);
                removeStreamIds.push(stream.id);
            } else {
                syncStreams.push(stream);
            }
        });

        var queue = Promise.resolve();
        if (migrateStreamIds.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var item = migrateStreamIds.shift();
                    if (!item) return;

                    return _this.gOptions.db.transaction(function (connection) {
                        return _this.gOptions.msgStack.migrateStream(connection, item[0], item[1]).catch(function (err) {
                            debug('migrateStreams', err);
                        });
                    });
                });
            });
        }
        if (newStreams.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var stream = newStreams.shift();
                    if (!stream) return;

                    return _this.gOptions.users.getChatIdsByChannel(stream.service, stream.channelId).then(function (chatIds) {
                        return _this.gOptions.db.transaction(function (connection) {
                            return _this.gOptions.msgStack.setStream(connection, stream).then(function () {
                                return _this.gOptions.msgStack.addChatIdsStreamId(connection, chatIds, stream.id);
                            });
                        });
                    }).catch(function (err) {
                        debug('newStreams', err);
                    });
                });
            });
        }
        if (updateStreams.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var stream = updateStreams.shift();
                    if (!stream) return;

                    return _this.gOptions.msgStack.getStreamMessages(stream.id).then(function (messages) {
                        messages = messages.filter(function (item) {
                            return !/^@/.test(item.chatId);
                        });
                        return _this.gOptions.db.transaction(function (connection) {
                            return _this.gOptions.msgStack.setStream(connection, stream).then(function () {
                                return _this.gOptions.msgStack.updateChatIdsStreamId(connection, messages, stream.id);
                            });
                        });
                    }).catch(function (err) {
                        debug('updateStreams', err);
                    });
                });
            });
        }
        if (offlineStreams.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var stream = offlineStreams.shift();
                    if (!stream) return;

                    return _this.gOptions.msgStack.getStreamMessages(stream.id).then(function (messages) {
                        messages = messages.filter(function (item) {
                            return !/^@/.test(item.chatId);
                        });
                        return _this.gOptions.db.transaction(function (connection) {
                            return _this.gOptions.msgStack.setStream(connection, stream).then(function () {
                                return _this.gOptions.msgStack.updateChatIdsStreamId(connection, messages, stream.id);
                            });
                        });
                    }).catch(function (err) {
                        debug('offlineStreams', err);
                    });
                });
            });
        }
        if (timeoutStreams.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var stream = timeoutStreams.shift();
                    if (!stream) return;

                    return _this.gOptions.msgStack.getStreamMessages(stream.id).then(function (messages) {
                        messages = messages.filter(function (item) {
                            return !/^@/.test(item.chatId);
                        });
                        return _this.gOptions.db.transaction(function (connection) {
                            return _this.gOptions.msgStack.setStream(connection, stream).then(function () {
                                return _this.gOptions.msgStack.updateChatIdsStreamId(connection, messages, stream.id);
                            });
                        });
                    }).catch(function (err) {
                        debug('timeoutStreams', err);
                    });
                });
            });
        }
        if (syncStreams.length) {
            queue = queue.then(function () {
                return insertPool.do(function () {
                    var stream = syncStreams.shift();
                    if (!stream) return;

                    return _this.gOptions.db.transaction(function (connection) {
                        return _this.gOptions.msgStack.setStream(connection, stream).catch(function (err) {
                            debug('syncStreams', err);
                        });
                    });
                });
            });
        }
        if (removeStreamIds.length) {
            queue = queue.then(function () {
                return _this.gOptions.msgStack.removeStreamIds(removeStreamIds).catch(function (err) {
                    debug('removeStreamIds', err);
                });
            });
        }
        return queue;
    }).then(function () {
        _this.gOptions.events.emit('checkStack');
    }).catch(function (err) {
        debug('insertStreams', err);
    });
};

module.exports = LiveController;