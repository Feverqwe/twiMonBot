import ErrorWithCode from '../tools/errorWithCode';
import * as s from 'superstruct';
import Main from '../main';
import parallel from '../tools/parallel';
import arrayByPart from '../tools/arrayByPart';
import {ServiceInterface, ServiceStream} from '../checker';
import fetchRequest, {HTTPError} from '../tools/fetchRequest';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Goodgame');

const StreamStrict = s.object({
  id: s.number(),
  key: s.string(),
  url: s.string(),
  channel: s.object({
    id: s.number(),
    key: s.string(),
    url: s.string(),
  }),
});

const StreamsStruct = s.object({
  _embedded: s.object({
    streams: s.array(
      s.object({
        key: s.string(),
        status: s.string(),
        id: s.number(),
        viewers: s.string(),
        channel: s.object({
          id: s.number(),
          key: s.string(),
          title: s.string(),
          url: s.string(),
          thumb: s.string(),
          games: s.array(
            s.object({
              title: s.nullable(s.string()),
            }),
          ),
        }),
      }),
    ),
  }),
});

class Goodgame implements ServiceInterface {
  id = 'goodgame';
  name = 'Goodgame';
  batchSize = 25;
  noCachePreview = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [/goodgame\.ru\//i].some((re) => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: number[] = [];
    const removedChannelIds: number[] = [];
    return parallel(10, arrayByPart(channelIds, 25), (channelIds) => {
      return fetchRequest('https://api2.goodgame.ru/v2/streams', {
        searchParams: {
          ids: channelIds.join(','),
          adult: true,
          hidden: true,
        },
        headers: {
          Accept: 'application/vnd.goodgame.v2+json',
        },
        keepAlive: true,
        responseType: 'json',
      })
        .then(({body}) => {
          const streams = s.mask(body, StreamsStruct)._embedded.streams;

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
        })
        .catch((err: any) => {
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
      return this.requestChannelById(channelId).then(
        () => {
          resultChannelIds.push(channelId);
        },
        (err: any) => {
          if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
            // pass
          } else {
            debug('requestChannelById (%s) error: %o', channelId, err);
            resultChannelIds.push(channelId);
          }
        },
      );
    }).then(() => resultChannelIds);
  }

  findChannel(query: string) {
    return this.getChannelIdByUrl(query)
      .catch((err) => {
        if (err.code === 'IS_NOT_CHANNEL_URL') {
          // pass
          return query;
        }
        throw err;
      })
      .then((query) => {
        return this.requestChannelById(query);
      });
  }

  requestChannelById(channelId: string | number) {
    return fetchRequest('https://api2.goodgame.ru/v2/streams/' + encodeURIComponent(channelId), {
      headers: {
        Accept: 'application/vnd.goodgame.v2+json',
      },
      keepAlive: true,
      responseType: 'json',
    }).then(
      ({body}) => {
        const stream = s.mask(body, StreamStrict);
        const id = stream.channel.id;
        const url = stream.channel.url;
        const title = stream.channel.key;
        return {id, title, url};
      },
      (err: HTTPError) => {
        if (err.name === 'HTTPError' && err.response.statusCode === 404) {
          throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
        }
        throw err;
      },
    );
  }

  async getChannelIdByUrl(url: string) {
    let channelId = '';
    [/goodgame\.ru\/channel\/([\w\-]+)/i].some((re) => {
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
