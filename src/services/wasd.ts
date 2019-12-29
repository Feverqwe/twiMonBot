import {ServiceChannel, ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import {struct} from "superstruct";
import got from "../tools/gotWithTimeout";
import promiseTry from "../tools/promiseTry";
import ErrorWithCode from "../tools/errorWithCode";
import parallel from "../tools/parallel";
import arrayByPart from "../tools/arrayByPart";

const debug = require('debug')('app:Wasd');
const {CookieJar} = require('tough-cookie');
const promiseLimit = require('promise-limit');

const cookieJar = new CookieJar();

interface Stream {
  media_container_id: number,
  channel_id: number,
  media_container_streams: [{
    stream_id: number,
    stream_name: string,
    stream_status: string,
    stream_current_viewers: number,
    channel_id: number,
    stream_media: [{
      media_id: number,
      media_status: string,
      media_meta: {
        media_preview_url: string,
      }
    }],
    stream_channel: {
      channel_name: string,
    }
  }],
}

const Stream: (any: any) => Stream = struct.pick({
  media_container_id: 'number',
  channel_id: 'number',
  media_container_streams: [struct.pick({
    stream_id: 'number',
    stream_name: 'string',
    stream_status: 'string', // RUNNING
    stream_current_viewers: 'number',
    channel_id: 'number',
    stream_media: [struct.pick({
      media_id: 'number',
      media_status: 'string', // RUNNING
      media_meta: struct.pick({
        media_preview_url: 'string'
      })
    })],
    stream_channel: struct.pick({
      channel_name: 'string'
    })
  })]
});

interface StreamList {
  result: [Stream],
}

const StreamList: (any: any) => StreamList = struct.pick({
  result: [Stream]
});

interface Channel {
  result: {
    channel_id: number,
    channel_name: string,
  }
}

const Channel: (any: any) => Channel = struct.pick({
  result: struct.pick({
    channel_id: 'number',
    channel_name: 'string',
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
      /wasd\.tv\/channel\/\d+/i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams:ServiceStream[] = [];
    const skippedChannelIds:number[] = [];
    const removedChannelIds:number[] = [];
    return parallel(10, arrayByPart(channelIds, 100), (channelIds) => {
      return retryIfLocationMismatch(() => {
        return prepCookieJar().then(() => {
          return got('https://wasd.tv/api/media-containers', {
            query: {
              media_container_status: 'RUNNING',
              limit: 100,
              offset: 0,
              channel_id: channelIds.join(',')
            },
            timeout: 10 * 1000,
            cookieJar: cookieJar,
            json: true,
          });
        });
      }).then(({body}: any) => {
        const streamList = StreamList(body).result;

        streamList.forEach(({channel_id, media_container_streams}) => {
          media_container_streams.forEach((stream) => {
            if (stream.stream_status !== 'RUNNING') return;
            if (stream.channel_id !== channel_id) return;

            const previews: string[] = [];
            stream.stream_media.forEach((media) => {
              if (media.media_status === 'RUNNING' && media.media_meta.media_preview_url) {
                previews.push(media.media_meta.media_preview_url);
              }
            });

            resultStreams.push({
              id: stream.stream_id,
              url: getChannelUrl(stream.channel_id),
              title: stream.stream_name,
              game: null,
              isRecord: false,
              previews: previews,
              viewers: stream.stream_current_viewers,
              channelId: stream.channel_id,
              channelTitle: stream.stream_channel.channel_name,
              channelUrl: getChannelUrl(stream.channel_id),
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
    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return query;
      } else {
        throw err;
      }
    }).then((channelId) => {
      return this.requestChannelById(channelId);
    }).then(({body}: any) => {
      const channel = Channel(body).result;
      const id = channel.channel_id;
      const title = channel.channel_name;
      const url = getChannelUrl(id);
      return {id, title, url};
    });
  }

  requestChannelById(channelId: number | string) {
    return retryIfLocationMismatch(() => {
      return prepCookieJar().then(() => {
        return got('https://wasd.tv/api/channels/' + encodeURIComponent(channelId), {
          timeout: 10 * 1000,
          cookieJar: cookieJar,
          json: true,
        });
      });
    }).catch((err: any) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  async getChannelIdByUrl(url: string) {
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
      await got('https://wasd.tv/api/auth/anon-token', {
        method: 'POST',
        timeout: 10 * 1000,
        cookieJar: cookieJar,
      });
    }
  });
}

function retryIfLocationMismatch(cb: () => {}) {
  return promiseTry(() => cb()).catch(async (err) => {
    const bodyError = err.body && err.body.error;
    if (bodyError && bodyError.statusCode === 401 && ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_LOCATION_MISMATCH'].includes(bodyError.code)) {
      await new Promise((resolve, reject) => cookieJar.removeAllCookies((err: any) => {
        err ? reject(err) : resolve();
      }));
      return cb();
    }
    throw err;
  });
}

export default Wasd;