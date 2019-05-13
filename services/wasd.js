const debug = require('debug')('app:wasd');
const splitByPart = require('../tools/splitByPart');
const parallel = require('../tools/parallel');
const {struct} = require('superstruct');
const base = require('../base');
const ErrorWithCode = require('../errorWithCode');
const {CustomError} = require("../customError");
const got = require('got');
const {CookieJar} = require('tough-cookie');
const promiseLimit = require('promise-limit');
const singleThread = promiseLimit(1);

const StreamList = struct.partial({
  result: [struct.partial({
    media_container_id: 'number',
    channel_id: 'number',
    media_container_streams: [struct.partial({
      stream_id: 'number',
      stream_name: 'string',
      stream_status: 'string', // RUNNING
      stream_current_viewers: 'number',
      channel_id: 'number',
      stream_media: [struct.partial({
        media_id: 'number',
        media_status: 'string', // RUNNING
        media_meta: struct.partial({
          media_preview_url: 'string'
        })
      })],
      stream_channel: struct.partial({
        channel_name: 'string'
      })
    })]
  })]
});

const Channel = struct.partial({
  result: struct.partial({
    channel_id: 'number',
    channel_name: 'string',
  })
});

class Wasd {
  constructor(/**Main*/main) {
    this.main = main;
    this.name = 'wasd';
    this.cookieJar = new CookieJar();
  }

  isServiceUrl(url) {
    return [
      /wasd\.tv\/channel\/\d+/i
    ].some((re) => re.test(url));
  }

  getChannelUrl(channelId) {
    return 'https://wasd.tv/channel/' + encodeURIComponent(channelId);
  }

  prepCookieJar() {
    return singleThread(async () => {
      const cookies = await new Promise((resolve, reject) => this.cookieJar.getCookies('https://wasd.tv/', {}, (err, result) => {
        err ? reject(err) : resolve(result);
      }));
      const hasToken = cookies.some((item) => {
        if (item.key === 'cronos-auth-token') {
          return true;
        }
      });
      const hasTokenSignature = cookies.some((item) => {
        if (item.key === 'cronos-auth-token-signature') {
          return true;
        }
      });

      if (!hasToken || !hasTokenSignature) {
        await this.gotWithProxy('https://wasd.tv/api/auth/anon-token', {
          method: 'POST',
          timeout: 10 * 1000,
          cookieJar: this.cookieJar,
        });
      }
    });
  }

  retryIfLocationMismatch(cb) {
    return Promise.resolve(cb()).catch(async (err) => {
      const bodyError = err.body && err.body.error;
      if (bodyError && bodyError.statusCode === 401 && bodyError.code === 'AUTH_TOKEN_LOCATION_MISMATCH') {
        await new Promise((resolve, reject) => this.cookieJar.removeAllCookies((err) => {
          err ? reject(err) : resolve();
        }));
        return cb();
      }
      throw err;
    });
  }

  async insertItem(channel, stream, mediaContainerId) {
    const id = stream.stream_id;

    if (stream.stream_status !== 'RUNNING') {
      throw new ErrorWithCode('IS_NOT_RUNNING', 'IS_NOT_RUNNING');
    }

    const previews = [];
    stream.stream_media.forEach((media) => {
      if (media.media_status === 'RUNNING' && media.media_meta.media_preview_url) {
        previews.push(media.media_meta.media_preview_url);
      }
    });

    const data = {
      isRecord: false,
      viewers: stream.stream_current_viewers,
      game: '',
      preview: previews,
      created_at: undefined,
      channel: {
        name: stream.stream_channel.channel_name,
        status: stream.stream_name,
        url: this.getChannelUrl(stream.channel_id) + '/videos/' + mediaContainerId
      }
    };
    const item = {
      id: this.main.channels.wrapId(id, this.name),
      channelId: channel.id,
      data: JSON.stringify(data),
      checkTime: base.getNow(),
      isOffline: 0,
      isTimeout: 0
    };

    if (channel.title !== stream.stream_channel.channel_name) {
      channel.title = stream.stream_channel.channel_name;
      await this.main.channels.updateChannel(channel.id, channel);
    }

    return item;
  }

  getStreamList(channels) {
    const results = [];
    return Promise.resolve().then(() => {
      if (!channels.length) return;

      return parallel(1, splitByPart(channels, 100), (channels) => {
        const channelIdChannelMap = {};
        channels.forEach((channel) => {
          const id = this.main.channels.unWrapId(channel.id);
          channelIdChannelMap[id] = channel;
        });
        return this.retryIfLocationMismatch(() => {
          return this.prepCookieJar().then(() => {
            return this.gotWithProxy('https://wasd.tv/api/media-containers', {
              query: {
                media_container_status: 'RUNNING',
                limit: 100,
                offset: 0,
                channel_id: Object.keys(channelIdChannelMap).join(',')
              },
              timeout: 10 * 1000,
              cookieJar: this.cookieJar,
              json: true,
            });
          });
        }).then(({body}) => {
          const streamList = StreamList(body).result;
          return parallel(15, streamList, (mediaContainer) => {
            return Promise.resolve().then(() => {
              const channel = channelIdChannelMap[mediaContainer.channel_id];
              if (!channel) {
                const err = new Error('Channel is not found!');
                err.stream = mediaContainer;
                throw err;
              }

              return parallel(1, mediaContainer.media_container_streams, (stream) => {
                if (mediaContainer.channel_id !== stream.channel_id) {
                  debug('Skip mediaContainer stream, cause channels is not equal', mediaContainer.channel_id, stream.channel_id);
                  return ;
                }

                return this.insertItem(channel, stream, mediaContainer.media_container_id).then((stream) => {
                  results.push(stream);
                }, (err) => {
                  if (err.code === 'IS_NOT_RUNNING') {
                    // pass
                  } else {
                    results.push(base.getTimeoutStream(channel));
                    throw err;
                  }
                });
              });
            }).catch((err) => {
              debug("insertItem error!", err);
            });
          });
        }).catch((err) => {
          debug("Request stream list error! %o", err);
          channels.forEach((channel) => {
            results.push(base.getTimeoutStream(channel));
          });
        });
      });
    }).then(() => results);
  }

  channelExists(channel) {
    const channelId = this.main.channels.unWrapId(channel.id);
    return this.getChannelId(channelId).catch((err) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_NOT_FOUND');
      }
      throw err;
    });
  }

  async getChannelIdByUrl(url) {
    let channelId = '';
    [
      /wasd\.tv\/channel\/(\d+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = m[1];
        return true;
      }
    });
    if (!channelId) {
      throw new CustomError("Is not channel url!");
    }

    return channelId;
  }

  getChannelId(channelName) {
    return this.getChannelIdByUrl(channelName).catch((err) => {
      if (!(err instanceof CustomError)) {
        throw err;
      }
      return channelName;
    }).then((channelId) => {
      return this.retryIfLocationMismatch(() => {
        return this.prepCookieJar().then(() => {
          return this.gotWithProxy('https://wasd.tv/api/channels/' + encodeURIComponent(channelId), {
            timeout: 10 * 1000,
            cookieJar: this.cookieJar,
            json: true,
          });
        });
      }).then(({body}) => {
        const channel = Channel(body).result;
        const id = channel.channel_id;
        const title = channel.channel_name;
        const url = this.getChannelUrl(id);
        return this.main.channels.insertChannel(id, this.name, title, url);
      });
    });
  }

  gotWithProxy(url, options) {
    return got(url, options).catch((err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        if (this.main.proxyList.hasOnline()) {
          return this.main.proxyList.got(url, options);
        }
      }
      throw err;
    });
  }
}

module.exports = Wasd;