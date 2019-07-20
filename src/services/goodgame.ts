import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import Main from "../main";
import parallel from "../tools/parallel";
import arrayByPart from "../tools/arrayByPart";
import withRetry from "../tools/withRetry";

const got = require('got');
const debug = require('debug')('app:Goodgame');

interface Stream {
  key: string,
  url: string
}

const Stream = struct.partial({
  key: 'string',
  url: 'string',
});

interface Streams {
  _embedded: {
    streams: [{
      key: string,
      status: string,
      id: number,
      viewers: string,
      channel: {
        title: string,
        url: string,
        thumb: string,
        games: [{
          title: string|null
        }]
      }
    }]
  }
}

const Streams = struct.partial({
  _embedded: struct.partial({
    streams: [struct.partial({
      key: 'string',
      status: 'string',
      id: 'number',
      viewers: 'string',
      channel: struct.partial({
        title: 'string',
        url: 'string',
        thumb: 'string',
        games: [struct.partial({
          title: 'string|null'
        })],
      })
    })]
  }),
});

class Goodgame {
  main: Main;
  id: string;
  name: string;
  constructor(main: Main) {
    this.main = main;
    this.id = 'goodgame';
    this.name = 'Goodgame';
  }

  match(url: string) {
    return [
      /goodgame\.ru\//i
    ].some(function (re) {
      return re.test(url);
    });
  }

  getStreams(channelIds: string[]) {
    const resultStreams = [];
    const skippedChannelIds = [];
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
        // @ts-ignore
        const streams = (Streams(body) as Streams)._embedded.streams;

        streams.forEach((stream) => {
          if (stream.status !== 'Live') return;

          const channelId = stream.key.toLowerCase();
          if (!channelIds.includes(channelId)) {
            debug(`getStreams for channel (%j) skip, cause: Not required`, channelId);
            return;
          }

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
            previews.push(thumb);
          }

          let viewers = parseInt(stream.viewers, 10);
          if (!isFinite(viewers)) {
            viewers = null;
          }

          resultStreams.push({
            id: '' + stream.id,
            url: stream.channel.url,
            title: stream.channel.title,
            game: gameTitle,
            isRecord: false,
            previews: previews,
            viewers: viewers,
            channelId: channelId,
            channelTitle: stream.key,
          });
        });
      }).catch((err) => {
        debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
        skippedChannelIds.push(...channelIds);
      });
    }).then(() => {
      return {resultStreams, skippedChannelIds};
    });
  }

  getExistsChannelIds(ids: string[]) {
    const resultChannelIds = [];
    return parallel(10, ids, (channelId) => {
      return this.requestChannelById(channelId).then(() => {
        resultChannelIds.push(channelId);
      }, (err) => {
        if (err.code === 'CHANNEL_BY_QUERY_IS_NOT_FOUND') {
          // pass
        } else {
          debug('requestChannelById (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
          throw err;
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

  requestChannelById(channelId: string) {
    return this.gotWithProxy('https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelId), {
      headers: {
        'Accept': 'application/vnd.goodgame.v2+json'
      },
      json: true,
    }).then(({body}: {body: object}) => {
      // @ts-ignore
      const stream = Stream(body) as Stream;
      const id = stream.key.toLowerCase();
      const url = stream.url;
      const title = stream.key;
      return {id, title, url};
    }, (err) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
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

  gotWithProxy(url: string, options: object) {
    return got(url, options).catch((err: ErrorWithCode) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        if (this.main.proxy.hasOnline()) {
          return this.main.proxy.got(url, options);
        }
      }
      throw err;
    });
  }
}

export default Goodgame;