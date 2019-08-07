import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import Main from "../main";
import parallel from "../tools/parallel";
import arrayByPart from "../tools/arrayByPart";
import withRetry from "../tools/withRetry";
import {ServiceInterface, ServiceStream} from "../checker";
import promiseTry from "../tools/promiseTry";
import noCacheUrl from "../tools/noCacheUrl";

const got = require('got');
const debug = require('debug')('app:Goodgame');

interface Stream {
  id: number,
  key: string,
  url: string,
  channel: {
    id: number,
    key: string,
    url: string,
  },
}

const Stream: (any: any) => Stream = struct(struct.partial({
  id: 'number',
  key: 'string',
  url: 'string',
  channel: struct.partial({
    id: 'number',
    key: 'string',
    url: 'string',
  }),
}));

interface Streams {
  _embedded: {
    streams: {
      key: string,
      status: string,
      id: number,
      viewers: string,
      channel: {
        id: number,
        key: string,
        title: string,
        url: string,
        thumb: string,
        games: {
          title: string|null
        }[]
      }
    }[]
  }
}

const Streams = struct(struct.partial({
  _embedded: struct.partial({
    streams: [struct.partial({
      key: 'string',
      status: 'string',
      id: 'number',
      viewers: 'string',
      channel: struct.partial({
        id: 'number',
        key: 'string',
        title: 'string',
        url: 'string',
        thumb: 'string',
        games: [struct.partial({
          title: 'string|null'
        })],
      })
    })]
  }),
}));

class Goodgame implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  batchSize: number;
  withProxy: boolean;
  noCachePreview: boolean;
  constructor(main: Main) {
    this.main = main;
    this.id = 'goodgame';
    this.name = 'Goodgame';
    this.batchSize = 25;
    this.withProxy = true;
    this.noCachePreview = true;
  }

  match(url: string) {
    return [
      /goodgame\.ru\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams:ServiceStream[] = [];
    const skippedChannelIds:number[] = [];
    const removedChannelIds:number[] = [];
    return parallel(10, arrayByPart(channelIds, 25), (channelIds) => {
      return withRetry({count: 3, timeout: 250}, () => {
        return this.gotWithProxy('https://api2.goodgame.ru/v2/streams', {
          query: {
            ids: channelIds.join(','),
            adult: true,
            hidden: true
          },
          headers: {
            'Accept': 'application/vnd.goodgame.v2+json'
          },
          json: true,
        });
      }).then(({body}) => {
        const streams = (Streams(body) as Streams)._embedded.streams;

        streams.forEach((stream) => {
          if (stream.status !== 'Live') return;

          let gameTitle = null;
          stream.channel.games.some((game) => {
            if (game.title) {
              gameTitle = game.title;
              return true;
            }
          });

          const previews = [];
          let thumb = stream.channel.thumb.replace(/_240(\.jpg)$/, '$1');
          if (/^\/\//.test(thumb)) {
            thumb = 'https:' + thumb;
          }
          if (thumb) {
            previews.push(noCacheUrl(thumb));
          }

          let viewers = parseInt(stream.viewers, 10);
          if (!isFinite(viewers)) {
            viewers = null;
          }

          resultStreams.push({
            id: stream.id,
            url: stream.channel.url,
            title: stream.channel.title,
            game: gameTitle,
            isRecord: false,
            previews: previews,
            viewers: viewers,
            channelId: stream.channel.id,
            channelTitle: stream.channel.key,
          });
        });
      }).catch((err) => {
        debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
        skippedChannelIds.push(...channelIds);
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  getExistsChannelIds(ids: number[]) {
    const resultChannelIds: number[] = [];
    return parallel(10, ids, (channelId) => {
      return this.requestChannelById(channelId).then(() => {
        resultChannelIds.push(channelId);
      }, (err: any) => {
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          // pass
        } else {
          debug('requestChannelById (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
        }
      });
    }).then(() => resultChannelIds);
  }

  findChannel(query: string) {
    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        // pass
        return query;
      }
      throw err;
    }).then((query) => {
      return this.requestChannelById(query);
    });
  }

  requestChannelById(channelId: string|number) {
    return this.gotWithProxy('https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelId), {
      headers: {
        'Accept': 'application/vnd.goodgame.v2+json'
      },
      json: true,
    }).then(({body}: {body: object}) => {
      const stream = Stream(body);
      const id = stream.channel.id;
      const url = stream.channel.url;
      const title = stream.channel.key;
      return {id, title, url};
    }, (err: any) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  async getChannelIdByUrl(url: string) {
    let channelId = null;
    [
      /goodgame\.ru\/channel\/([\w\-]+)/i
    ].some((re: RegExp) => {
      const m = re.exec(url);
      if (m) {
        channelId = m[1];
        return true;
      }
      return false;
    });

    if (!channelId) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    return channelId;
  }

  lastDirectConnectTryAt: number = null;
  gotWithProxy = (url: string, options: object)  => {
    return promiseTry(() => {
      const tryDate = new Date();
      tryDate.setHours(tryDate.getHours() - 3);
      if (!this.lastDirectConnectTryAt || this.lastDirectConnectTryAt < tryDate.getTime()) {
        this.lastDirectConnectTryAt = Date.now();
        return got(url, {timeout: 5 * 1000, ...options}).then((result: any) => {
          this.lastDirectConnectTryAt = null;
          return result;
        });
      } else {
        throw new ErrorWithCode('Direct connect is not available', 'DIRECT_CONNECT_IS_NOT_AVAILABLE');
      }
    }).catch((err) => {
      if (err.name === 'TimeoutError' ||
        ['DIRECT_CONNECT_IS_NOT_AVAILABLE', 'ECONNRESET', 'ETIMEDOUT'].includes(err.code)
      ) {
        if (this.main.proxy.hasOnline()) {
          return this.main.proxy.got(url, options);
        }
      }
      throw err;
    });
  };
}

export default Goodgame;