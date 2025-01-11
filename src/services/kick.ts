import {ServiceChannel, ServiceGetStreamsResult, ServiceInterface, ServiceStream} from '../checker';
import parallel from '../tools/parallel';
import ErrorWithCode from '../tools/errorWithCode';
import {getDebug} from '../tools/getDebug';
import fetchRequest, {HTTPError} from '../tools/fetchRequest';
import * as s from 'superstruct';
import Main from '../main';
import {appConfig} from '../appConfig';

const debug = getDebug('app:kick');

const HEADERS = appConfig.kickHeaders;

const StreamStruct = s.object({
  data: s.nullable(
    s.object({
      id: s.number(),
      // slug: s.string(),
      session_title: s.string(),
      created_at: s.string(),
      // language: s.string(),
      // is_mature: s.string(),
      viewers: s.number(),
      category: s.object({
        // id: s.number(),
        name: s.string(),
        // slug: s.string(),
        // tags: s.array(s.string()),
        // parent_category: s.object({
        //   id: s.number(),
        //   slug: s.string(),
        // })
      }),
      // playback_url: s.string(),
      thumbnail: s.object({
        // src: s.string(),
        srcset: s.string(),
      }),
    }),
  ),
});

const ChannelStrict = s.object({
  slug: s.string(),
  user: s.object({
    username: s.string(),
  }),
});

class Kick implements ServiceInterface<string> {
  id = 'kick';
  name = 'Kick (beta)';
  batchSize = 10;

  constructor(public main: Main) {}

  match(query: string): boolean {
    return [/kick\.com\//i].some((re) => re.test(query));
  }

  async getStreams(channelIds: string[]): Promise<ServiceGetStreamsResult<string>> {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: string[] = [];
    const removedChannelIds: string[] = [];

    await parallel(10, channelIds, async (channelId) => {
      try {
        const stream = await this.fetchStreamInfo(channelId);
        if (stream) {
          resultStreams.push(stream);
        }
      } catch (err) {
        debug(`getStreams for channel (%j) skip, cause: %o`, channelId, err);
        if ((err as ErrorWithCode).code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          removedChannelIds.push(channelId);
        } else {
          skippedChannelIds.push(channelId);
        }
      }
    });

    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async fetchStreamInfo(channelId: string) {
    const {body} = await fetchRequest(
      `https://kick.com/api/v2/channels/${encodeURIComponent(channelId)}/livestream`,
      {
        headers: HEADERS,
        cookie: true,
        keepAlive: true,
        responseType: 'json',
        http2: true,
      },
    ).catch((error) => {
      const err = error as HTTPError;
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });

    const {data: stream} = s.mask(body, StreamStruct);

    if (!stream) return;

    const previews: string[] = [];
    if (stream) {
      stream.thumbnail.srcset.split(/,\s+/).forEach((urlRes) => {
        const [url] = urlRes.split('s+');
        previews.push(url);
      });
    }

    return {
      id: stream.id,
      url: getChannelUrl(channelId),
      title: stream.session_title,
      game: stream.category.name,
      isRecord: false,
      previews: JSON.stringify(previews),
      viewers: stream.viewers,
      channelId: channelId,
      channelTitle: channelId,
      channelUrl: getChannelUrl(channelId),
    };
  }

  async getExistsChannelIds(channelIds: string[]): Promise<string[]> {
    const resultChannelIds: string[] = [];
    await parallel(10, channelIds, async (channelId) => {
      try {
        await this.fetchChannelInfo(channelId);
        resultChannelIds.push(channelId);
      } catch (error) {
        const err = error as ErrorWithCode;
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          // pass
        } else {
          debug('fetchChannelInfo (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
        }
      }
    });
    return resultChannelIds;
  }

  async findChannel(query: string): Promise<ServiceChannel> {
    const channelId = await this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return query;
      }
      throw err;
    });
    return this.fetchChannelInfo(channelId);
  }

  async getChannelIdByUrl(url: string) {
    let channelId = '';
    [/kick\.com\/([\w\-]+)/i].some((re) => {
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

  async fetchChannelInfo(channelId: string) {
    const {body} = await fetchRequest(
      'https://kick.com/api/v1/channels/' + encodeURIComponent(channelId),
      {
        headers: HEADERS,
        cookie: true,
        keepAlive: true,
        responseType: 'json',
        http2: true,
      },
    ).catch((error) => {
      const err = error as HTTPError;
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });

    const blog = s.mask(body, ChannelStrict);
    const id = blog.slug;
    const url = getChannelUrl(blog.slug);
    const title = blog.user.username;
    return {id, title, url};
  }
}

function getChannelUrl(name: string) {
  return `https://kick.com/${encodeURIComponent(name)}`;
}

export default Kick;
