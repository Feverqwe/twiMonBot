import {ServiceChannel, ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import * as s from "superstruct";
import promiseTry from "../tools/promiseTry";
import ErrorWithCode from "../tools/errorWithCode";
import parallel from "../tools/parallel";
import arrayByPart from "../tools/arrayByPart";
import promiseLimit from "../tools/promiseLimit";
import fetchRequest, {HTTPError} from "../tools/fetchRequest";

const debug = require('debug')('app:Wasd');
const {CookieJar} = require('tough-cookie');

const cookieJar = new CookieJar();

const StreamStruct = s.type({
  media_container_id: s.number(),
  media_container_name: s.string(),
  media_container_status: s.string(),
  channel_id: s.number(),
  media_container_streams: s.array(s.type({
    stream_id: s.number(),
    stream_current_viewers: s.number(),
    stream_media: s.array(s.type({
      media_id: s.number(),
      media_status: s.string(), // RUNNING
      media_meta: s.type({
        media_preview_url: s.string()
      })
    })),
  })),
  media_container_user: s.type({
    channel_id: s.number(),
  }),
  media_container_channel: s.type({
    channel_name: s.string(),
  }),
});

const StreamListStruct = s.type({
  result: s.array(StreamStruct),
});

const ChannelStruct = s.type({
  result: s.type({
    channel_id: s.number(),
    channel_name: s.string(),
  })
});

class Wasd implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  batchSize: number;
  noCachePreview: boolean;
  constructor(main: Main) {
    this.main = main;
    this.id = 'wasd';
    this.name = 'Wasd';
    this.batchSize = 100;
    this.noCachePreview = true;
  }

  match(url: string) {
    return [
      /wasd\.tv\/[^\/]+/i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams:ServiceStream[] = [];
    const skippedChannelIds:number[] = [];
    const removedChannelIds:number[] = [];
    return parallel(10, arrayByPart(channelIds, 100), (channelIds) => {
      return retryIfLocationMismatch(() => {
        return prepCookieJar().then(() => {
          return fetchRequest('https://wasd.tv/api/v2/media-containers', {
            searchParams: {
              media_container_status: 'RUNNING',
              limit: 100,
              offset: 0,
              channel_id: channelIds.join(',')
            },
            cookieJar: cookieJar,
            responseType: 'json',
            keepAlive: true,
          });
        });
      }).then(({body}: any) => {
        const streamList = s.coerce(body, StreamListStruct).result;

        streamList.forEach((result) => {
          const {
            channel_id,
            media_container_status,
            media_container_name,
            media_container_streams,
            media_container_user,
            media_container_channel,
          } = result;
          if (media_container_status !== 'RUNNING') return;

          media_container_streams.forEach((stream) => {
            if (media_container_user.channel_id !== channel_id) return;

            const previews: string[] = [];
            stream.stream_media.forEach((media) => {
              if (media.media_status === 'RUNNING' && media.media_meta.media_preview_url) {
                previews.push(media.media_meta.media_preview_url);
              }
            });

            resultStreams.push({
              id: stream.stream_id,
              url: getChannelUrl(channel_id),
              title: media_container_name,
              game: null,
              isRecord: false,
              previews: previews,
              viewers: stream.stream_current_viewers,
              channelId: channel_id,
              channelTitle: media_container_channel.channel_name,
              channelUrl: getChannelUrl(channel_id),
            });
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

  getExistsChannelIds(ids: number[]): Promise<number[]> {
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

  findChannel(query: string): Promise<ServiceChannel> {
    return this.getChannelNameByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return query;
      } else {
        throw err;
      }
    }).then((query) => {
      return this.requestChannelByQuery(query);
    }).then(({body}: any) => {
      const channel = s.coerce(body, ChannelStruct).result;
      const id = channel.channel_id;
      const title = channel.channel_name;
      const url = getChannelUrl(id);
      return {id, title, url};
    });
  }

  requestChannelById(channelId: number) {
    return retryIfLocationMismatch(() => {
      return prepCookieJar().then(() => {
        return fetchRequest('https://wasd.tv/api/channels/' + encodeURIComponent(channelId), {
          cookieJar: cookieJar,
          responseType: 'json',
          keepAlive: true,
        });
      });
    }).catch((err: HTTPError) => {
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  requestChannelByQuery(query: string) {
    return retryIfLocationMismatch(() => {
      return prepCookieJar().then(() => {
        return fetchRequest('https://wasd.tv/api/channels/nicknames/' + encodeURIComponent(query), {
          cookieJar: cookieJar,
          responseType: 'json',
          keepAlive: true,
        });
      });
    }).catch((err: HTTPError) => {
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  async getChannelNameByUrl(url: string) {
    let channelId = '';
    [
      /wasd\.tv\/([^\/]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = m[1];
        return true;
      }
    });
    if (!channelId) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    return channelId;
  }
}

function getChannelUrl(channelId: number) {
  return 'https://wasd.tv/channel/' + encodeURIComponent(channelId);
}

const singleThread = promiseLimit(1);
function prepCookieJar() {
  return singleThread(async () => {
    const cookies: {key: string}[] = await new Promise((resolve, reject) => cookieJar.getCookies('https://wasd.tv/', {}, (err: any, result: any) => {
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
      await fetchRequest('https://wasd.tv/api/auth/anon-token', {
        method: 'POST',
        cookieJar: cookieJar,
        keepAlive: true,
      });
    }
  });
}

function retryIfLocationMismatch(cb: () => {}) {
  return promiseTry(() => cb()).catch(async (err: HTTPError) => {
    if (err.name === 'HTTPError') {
      const bodyError = err.response.body && err.response.body.error;
      if (bodyError && bodyError.status_code === 401 && ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_LOCATION_MISMATCH'].includes(bodyError.code)) {
        await new Promise((resolve, reject) => cookieJar.removeAllCookies((err: any) => {
          err ? reject(err) : resolve();
        }));
        return cb();
      }
    }
    throw err;
  });
}

export default Wasd;