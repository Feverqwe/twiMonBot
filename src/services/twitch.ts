import {ServiceInterface, ServiceStream} from '../checker';
import Main from '../main';
import parallel from '../tools/parallel';
import ErrorWithCode from '../tools/errorWithCode';
import * as s from 'superstruct';
import arrayByPart from '../tools/arrayByPart';
import fetchRequest, {FetchRequestOptions, HTTPError} from '../tools/fetchRequest';
import getNow from '../tools/getNow';
import promiseTry from '../tools/promiseTry';
import RateLimit2 from '../tools/rateLimit2';
import {appConfig} from '../appConfig';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Twitch');

const rateLimit = new RateLimit2(800, 60 * 1000);

const limitedFetchRequest = rateLimit.wrap(fetchRequest);
const requestSingleChannelLimit = new RateLimit2(400, 60 * 1000);

const ChannelsStruct = s.object({
  data: s.array(
    s.object({
      id: s.string(),
      broadcaster_login: s.string(),
      display_name: s.string(),
    }),
  ),
  pagination: s.object({
    cursor: s.optional(s.string()),
  }),
});

const StreamsStruct = s.object({
  data: s.array(
    s.object({
      id: s.string(),
      type: s.string(),
      thumbnail_url: s.string(),
      viewer_count: s.number(),
      game_name: s.string(),
      started_at: s.string(),
      user_id: s.string(),
      user_login: s.string(),
      user_name: s.string(),
      title: s.string(),
    }),
  ),
  pagination: s.object({
    cursor: s.optional(s.string()),
  }),
});

class Twitch implements ServiceInterface<number> {
  id = 'twitch';
  name = 'Twitch';
  batchSize = 100;
  noCachePreview = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [/twitch\.tv\//i].some((re) => re.test(url));
  }

  async getStreams(channelIds: number[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: number[] = [];
    const removedChannelIds: number[] = [];
    await parallel(10, arrayByPart(channelIds, 100), async (channelIds) => {
      try {
        const {body} = await this.signFetchRequest('https://api.twitch.tv/helix/streams', {
          searchParams: {
            user_id: channelIds,
            first: 100,
          },
          keepAlive: true,
          responseType: 'json',
        });

        const result = s.mask(body, StreamsStruct);
        const streams = result.data;

        streams.forEach((stream) => {
          const previews: string[] = [
            stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080'),
          ];

          let id: number | string = stream.id;
          let channelId: number | string = stream.user_id;
          // fallback api v3
          if (/^\d+$/.test(stream.id)) {
            id = parseInt(stream.id, 10);
          }
          if (/^\d+$/.test(stream.user_id)) {
            channelId = parseInt(stream.user_id, 10);
          }

          const url = getChannelUrl(stream.user_login);

          resultStreams.push({
            id: id,
            url: url,
            title: stream.title,
            game: stream.game_name,
            // new api don't response records anymore
            isRecord: false, // stream.type !== 'live',
            previews: JSON.stringify(previews),
            viewers: stream.viewer_count,
            channelId: channelId,
            channelTitle: stream.user_name,
            channelUrl: url,
          });
        });
      } catch (err) {
        debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
        skippedChannelIds.push(...channelIds);
      }
    });
    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async getExistsChannelIds(ids: number[]) {
    const resultChannelIds: number[] = [];
    await parallel(10, ids, async (channelId) => {
      try {
        await requestSingleChannelLimit.run(() => this.requestChannelById(channelId));

        resultChannelIds.push(channelId);
      } catch (error) {
        const err = error as ErrorWithCode;
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          // pass
        } else {
          debug('requestChannelById (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
        }
      }
    });
    return resultChannelIds;
  }

  async requestChannelById(channelId: number) {
    try {
      await this.signFetchRequest('https://api.twitch.tv/helix/channels', {
        searchParams: {
          broadcaster_id: channelId,
        },
        keepAlive: true,
      });
    } catch (error) {
      const err = error as HTTPError;
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    }
  }

  async findChannel(query: string) {
    let nameOrQuery;
    try {
      nameOrQuery = this.getChannelNameByUrl(query);
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        nameOrQuery = query;
      } else {
        throw err;
      }
    }

    const channel = await this.requestChannelByQuery(nameOrQuery);

    let id: number | string = channel.id;
    // fallback api v3
    if (/^\d+$/.test(channel.id)) {
      id = parseInt(channel.id, 10);
    }

    const title = channel.display_name;
    const url = getChannelUrl(channel.broadcaster_login);
    return {id, title, url};
  }

  async requestChannelByQuery(query: string) {
    const {body} = await this.signFetchRequest('https://api.twitch.tv/helix/search/channels', {
      searchParams: {
        query: query,
        first: 100,
      },
      keepAlive: true,
      responseType: 'json',
    });

    const channels = s.mask(body, ChannelsStruct).data;
    if (!channels.length) {
      throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
    }
    let result = channels.find((channel) => channel.broadcaster_login === query);
    if (!result) {
      result = channels[0];
    }
    return result;
  }

  getChannelNameByUrl(url: string) {
    let channelName = '';
    [/twitch\.tv\/([\w\-]+)/i].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelName = m[1].toLowerCase();
        return true;
      }
      return false;
    });

    if (!channelName) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    return channelName;
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
      const {body} = await fetchRequest('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        searchParams: {
          client_id: appConfig.twitchToken,
          client_secret: appConfig.twitchSecret,
          grant_type: 'client_credentials',
        },
        responseType: 'json',
      });

      s.assert(
        body,
        s.type({
          access_token: s.string(),
          expires_in: s.number(),
        }),
      );

      const expiresAt = Date.now() + body.expires_in * 1000;
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
        'Client-Id': appConfig.twitchToken,
      },
      options.headers,
    );

    return limitedFetchRequest(url, options);
  }
}

function getChannelUrl(userLogin: string) {
  return 'https://twitch.tv/' + encodeURIComponent(userLogin);
}

export default Twitch;
