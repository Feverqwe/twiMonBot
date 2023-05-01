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

const StreamStruct = s.object({
  media_container_id: s.number(),
  media_container_name: s.string(),
  media_container_status: s.string(),
  channel_id: s.number(),
  media_container_streams: s.array(s.object({
    stream_id: s.number(),
    stream_current_viewers: s.number(),
    stream_media: s.array(s.object({
      media_id: s.number(),
      media_status: s.string(), // RUNNING
      media_meta: s.object({
        media_preview_url: s.string()
      })
    })),
  })),
  media_container_user: s.object({
    channel_id: s.number(),
  }),
  media_container_channel: s.object({
    channel_name: s.string(),
  }),
});

const StreamListStruct = s.object({
  result: s.array(StreamStruct),
});

const ChannelStruct = s.object({
  result: s.object({
    channel_id: s.number(),
    channel_name: s.string(),
  })
});

class Wasd implements ServiceInterface {
  id = 'wasd';
  name = 'Wasd';
  batchSize = 100;
  noCachePreview = true;
  streamUrlWithoutChannelName = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [
      /wasd\.tv\/[^\/]+/i
    ].some(re => re.test(url));
  }

  async getStreams(channelIds: number[]) {
    return {streams: [], skippedChannelIds: [], removedChannelIds: []};

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
      }).then(({body}) => {
        const streamList = s.mask(body, StreamListStruct).result;

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

  findChannel(query: string): Promise<ServiceChannel> {
    return this.getChannelIdByUrl(query).then((channelId) => {
      return this.requestChannelById(channelId);
    }, (err) => {
      if (err.code !== 'IS_NOT_CHANNEL_URL') {
        throw err;
      }

      return this.getChannelNameByUrl(query).catch((err) => {
        if (err.code !== 'IS_NOT_CHANNEL_URL') {
          throw err;
        }

        return query;
      }).then((query) => {
        return this.requestChannelByQuery(query);
      });
    }).then(({body}) => {
      const channel = s.mask(body, ChannelStruct).result;
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

  async getChannelIdByUrl(url: string) {
    let channelId: number | null = null;
    [
      /wasd\.tv\/channel\/(\d+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = parseInt(m[1], 10);
        return true;
      }
    });
    if (!channelId) {
      throw new ErrorWithCode('Is not channel id url', 'IS_NOT_CHANNEL_URL');
    }

    return channelId!;
  }
}

function getChannelUrl(channelId: number) {
  return 'https://wasd.tv/channel/' + encodeURIComponent(channelId);
}

const singleThread = promiseLimit(1);
function prepCookieJar() {
  return singleThread(async () => {
    const cookies: {key: string}[] = await cookieJar.getCookies('https://wasd.tv/', {});
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

function retryIfLocationMismatch<T>(cb: () => Promise<T> | T) {
  return promiseTry(cb).catch(async (err: HTTPError) => {
    if (err.name === 'HTTPError') {
      const bodyError = err.response.body && err.response.body.error;
      if (bodyError && bodyError.status_code === 401 && ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_LOCATION_MISMATCH'].includes(bodyError.code)) {
        await cookieJar.removeAllCookies();
        return cb();
      }
    }
    throw err;
  });
}

export default Wasd;
