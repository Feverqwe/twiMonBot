import {ServiceChannel, ServiceGetStreamsResult, ServiceInterface, ServiceStream} from '../checker';
import parallel from '../tools/parallel';
import ErrorWithCode from '../tools/errorWithCode';
import {getDebug} from '../tools/getDebug';
import fetchRequest, {FetchRequestOptions, HTTPError} from '../tools/fetchRequest';
import * as s from 'superstruct';
import Main from '../main';
import {appConfig} from '../appConfig';
import getNow from '../tools/getNow';
import promiseTry from '../tools/promiseTry';
import crypto from 'node:crypto';

const debug = getDebug('app:kick');

const ChannelStrict = s.object({
  broadcaster_user_id: s.number(),
  slug: s.string(),
  channel_description: s.string(),
  banner_picture: s.string(),
  stream: s.object({
    url: s.string(),
    key: s.string(),
    is_live: s.boolean(),
    is_mature: s.boolean(),
    language: s.string(),
    start_time: s.string(),
    viewer_count: s.number(),
    thumbnail: s.string(),
  }),
  stream_title: s.string(),
  category: s.object({
    id: s.number(),
    name: s.string(),
    thumbnail: s.string(),
  }),
});

const ChannelsStrict = s.object({
  data: s.array(ChannelStrict),
  message: s.string(),
});

class Kick implements ServiceInterface<number> {
  id = 'kick';
  name = 'Kick';
  batchSize = 50;
  useHttp2 = true;

  constructor(public main: Main) {}

  match(query: string): boolean {
    return [/kick\.com\//i].some((re) => re.test(query));
  }

  async getStreams(channelIds: number[]): Promise<ServiceGetStreamsResult<number>> {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: number[] = [];
    const removedChannelIds: number[] = [];

    try {
      const {data: channels} = await this.getChannelInfo({broadcasterUserId: channelIds});

      channels.forEach((channel) => {
        const {stream, broadcaster_user_id: channelId, slug} = channel;
        if (!stream.is_live) return;

        const previews: string[] = [];
        if (stream) {
          previews.push(stream.thumbnail.replace(/\/\d+\.webp$/, '\/1080\.webp'));
          previews.push(stream.thumbnail);
        }

        const id = crypto.createHash('sha256')
          .update(`${channelId}-${stream.start_time}`)
          .digest('hex').slice(0, 16);

        const result = {
          id,
          url: getChannelUrl(slug),
          title: channel.stream_title,
          game: channel.category.name,
          isRecord: false,
          previews: JSON.stringify(previews),
          viewers: stream.viewer_count,
          channelId: channelId,
          channelTitle: slug,
          channelUrl: getChannelUrl(slug),
        };

        resultStreams.push(result);
      });
    } catch (err) {
      const httpError = err instanceof HTTPError ? err : undefined;
      debug(`getStreams for channel (%j) skip, cause: %o`, channelIds, err);
      if (httpError) {
        debug(`getStreams response body: %o`, httpError.response.body);
      }
      skippedChannelIds.push(...channelIds);
    }

    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async getExistsChannelIds(channelIds: number[]): Promise<number[]> {
    const resultChannelIds: number[] = [];
    await parallel(10, channelIds, async (channelId) => {
      try {
        const {data} = await this.getChannelInfo({broadcasterUserId: [channelId]});
        if (!data.length) {
          throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
        }

        resultChannelIds.push(channelId);
      } catch (error) {
        const err = error as ErrorWithCode;
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          // pass
        } else {
          debug('getChannelInfo (%s) error: %o', channelId, err);
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
    const {data} = await this.getChannelInfo({slug: [channelId]});
    if (!data.length) {
      throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
    }
    const [first] = data;
    const id = first.broadcaster_user_id;
    const url = getChannelUrl(first.slug);
    const title = first.slug;
    return {id, title, url};
  }

  token: null | {
    accessToken: string;
    expiresAt: number;
  } = null;

  lastAccessTokenRequest: Promise<string> | undefined;
  async getAccessToken() {
    if (this.token && this.token.expiresAt > getNow()) {
      return this.token.accessToken;
    }

    if (this.lastAccessTokenRequest) {
      return this.lastAccessTokenRequest;
    }

    return (this.lastAccessTokenRequest = promiseTry(async () => {
      const now = Date.now();
      const {body} = await fetchRequest('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        searchParams: {
          client_id: appConfig.kickToken,
          client_secret: appConfig.kickSecret,
          grant_type: 'client_credentials',
        },
        responseType: 'json',
      });

      s.assert(
        body,
        s.type({
          access_token: s.string(),
          expires_in: s.number(),
          token_type: s.string(),
        }),
      );

      const expiresAt = now + body.expires_in * 1000;
      this.token = {
        expiresAt,
        accessToken: body.access_token,
      };

      return this.token.accessToken;
    }).finally(() => {
      this.lastAccessTokenRequest = undefined;
    }));
  }

  async signFetchRequest(url: string, options: FetchRequestOptions) {
    options.headers = Object.assign(
      {
        Authorization: 'Bearer ' + (await this.getAccessToken()),
        'Client-Id': appConfig.kickToken,
      },
      options.headers,
    );

    return fetchRequest(url, options);
  }

  async getChannelInfo({slug, broadcasterUserId}: {slug?: string[]; broadcasterUserId?: number[]}) {
    const {body} = await this.signFetchRequest('https://api.kick.com/public/v1/channels', {
      searchParams: {
        ...(slug ? {slug} : {}),
        ...(broadcasterUserId ? {broadcaster_user_id: broadcasterUserId} : {}),
      },
      keepAlive: true,
      responseType: 'json',
    });

    const result = s.mask(body, ChannelsStrict);

    return result;
  }
}

function getChannelUrl(name: string) {
  return `https://kick.com/${encodeURIComponent(name)}`;
}

export default Kick;
