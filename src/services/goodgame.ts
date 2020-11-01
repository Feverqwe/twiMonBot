import ErrorWithCode from "../tools/errorWithCode";
import * as s from "superstruct";
import Main from "../main";
import parallel from "../tools/parallel";
import arrayByPart from "../tools/arrayByPart";
import {ServiceInterface, ServiceStream} from "../checker";
import got from "../tools/gotWithTimeout";

const debug = require('debug')('app:Goodgame');

const StreamStrict = s.type({
  id: s.number(),
  key: s.string(),
  url: s.string(),
  channel: s.type({
    id: s.number(),
    key: s.string(),
    url: s.string(),
  }),
});

const StreamsStruct = s.type({
  _embedded: s.type({
    streams: s.array(s.type({
      key: s.string(),
      status: s.string(),
      id: s.number(),
      viewers: s.string(),
      channel: s.type({
        id: s.number(),
        key: s.string(),
        title: s.string(),
        url: s.string(),
        thumb: s.string(),
        games: s.array(s.type({
          title: s.nullable(s.string())
        })),
      })
    }))
  }),
});

class Goodgame implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  batchSize: number;
  noCachePreview: boolean;
  constructor(main: Main) {
    this.main = main;
    this.id = 'goodgame';
    this.name = 'Goodgame';
    this.batchSize = 25;
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
      return got('https://api2.goodgame.ru/v2/streams', {
        query: {
          ids: channelIds.join(','),
          adult: true,
          hidden: true
        },
        headers: {
          'Accept': 'application/vnd.goodgame.v2+json'
        },
        json: true,
      }).then(({body}: any) => {
        const streams = s.coerce(body, StreamsStruct)._embedded.streams;

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
            previews.push(thumb);
          }

          let viewers: null | number = parseInt(stream.viewers, 10);
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
            channelUrl: stream.channel.url,
          });
        });
      }).catch((err: any) => {
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
    return got('https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelId), {
      headers: {
        'Accept': 'application/vnd.goodgame.v2+json'
      },
      json: true,
    }).then(({body}: {body: object}) => {
      const stream = s.coerce(body, StreamStrict);
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
}

export default Goodgame;