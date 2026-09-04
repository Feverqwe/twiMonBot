import {ServiceInterface, ServiceStream} from '../checker';
import Main from '../main';
import parallel from '../tools/parallel';
import ErrorWithCode from '../tools/errorWithCode';
import * as v from 'valibot';
import arrayByPart from '../tools/arrayByPart';
import fetchRequest, {HTTPError} from '../tools/fetchRequest';
import {decode as decodeHtmlEntity} from 'html-entities';
import ytCostCounter from '../tools/ytCostCounter';
import {appConfig} from '../appConfig';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Youtube');

const costCounter = ytCostCounter(150000);

const VideosItemsSnippetSchema = v.object({
  items: v.array(
    v.object({
      snippet: v.object({
        channelId: v.string(),
      }),
      liveStreamingDetails: v.optional(
        v.object({
          scheduledStartTime: v.optional(v.string()),
          actualStartTime: v.optional(v.string()),
          actualEndTime: v.optional(v.string()),
          concurrentViewers: v.optional(v.string()),
        }),
      ),
    }),
  ),
});

const ChannelsItemsIdSchema = v.object({
  items: v.optional(
    v.array(
      v.object({
        id: v.string(),
      }),
    ),
  ),
  nextPageToken: v.optional(v.string()),
});

const SearchItemsIdSchema = v.object({
  items: v.array(
    v.object({
      id: v.object({
        channelId: v.string(),
      }),
    }),
  ),
});

const SearchItemsIdVideoIdSchema = v.object({
  items: v.array(
    v.object({
      id: v.object({
        videoId: v.string(),
      }),
    }),
  ),
});

const SearchItemsSnippetSchema = v.object({
  items: v.array(
    v.object({
      snippet: v.object({
        channelId: v.string(),
        channelTitle: v.string(),
      }),
    }),
  ),
});

type SearchVideoResponseSnippet = v.InferOutput<typeof SearchVideoResponseSnippetSchema>;
const SearchVideoResponseSnippetSchema = v.object({
  title: v.string(),
  liveBroadcastContent: v.string(),
  publishedAt: v.string(),
  channelTitle: v.string(),
  channelId: v.string(),
});

const SearchVideoResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.object({
        videoId: v.string(),
      }),
      snippet: SearchVideoResponseSnippetSchema,
    }),
  ),
  nextPageToken: v.optional(v.string()),
});

const VideosResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.string(),
      liveStreamingDetails: v.optional(
        v.object({
          scheduledStartTime: v.optional(v.string()),
          actualStartTime: v.optional(v.string()),
          actualEndTime: v.optional(v.string()),
          concurrentViewers: v.optional(v.string()),
        }),
      ),
    }),
  ),
  nextPageToken: v.optional(v.string()),
});

class Youtube implements ServiceInterface<string> {
  id = 'youtube';
  name = 'Youtube';
  batchSize = 50;
  streamUrlWithoutChannelName = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [/youtu\.be\//i, /youtube\.com\//i].some((re) => re.test(url));
  }

  async getStreams(channelIds: string[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: string[] = [];
    const removedChannelIds: string[] = [];
    try {
      const streams = await this.main.webServer.ytPubSub.getStreams(channelIds, skippedChannelIds);

      streams.forEach(({id, title, viewers, channelId, channelTitle}) => {
        const previews = [
          'maxresdefault_live',
          'sddefault_live',
          'hqdefault_live',
          'mqdefault_live',
          'default_live',
        ].map((quality) => {
          return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
        });

        const normViewers = typeof viewers === 'number' ? viewers : null;

        resultStreams.push({
          id: id,
          game: null,
          isRecord: false,
          previews: JSON.stringify(previews),
          title: title,
          url: getVideoUrl(id),
          viewers: normViewers,
          channelId: channelId,
          channelTitle: channelTitle,
          channelUrl: getChannelUrl(channelId),
        });
      });
    } catch (err) {
      debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
      skippedChannelIds.push(...channelIds);
    }
    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async getStreamIdSnippetByChannelId(channelId: string, isUpcoming = false) {
    const idSnippet: Map<string, SearchVideoResponseSnippet> = new Map();
    await iterPages(async (pageToken) => {
      const query: Record<string, any> = {
        part: 'snippet',
        channelId: channelId,
        pageToken: pageToken,
        eventType: 'live',
        maxResults: 50,
        order: 'date',
        safeSearch: 'none',
        type: 'video',
        fields: 'items(id/videoId,snippet),nextPageToken',
        key: appConfig.ytToken,
      };

      if (isUpcoming) {
        query.eventType = 'upcoming';
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - 7);
        query.publishedAfter = minDate.toISOString();
      }

      await costCounter.inc(100);
      const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
        searchParams: query,
        keepAlive: true,
        responseType: 'json',
      });

      const result = v.parse(SearchVideoResponseSchema, body);

      result.items.forEach((item) => {
        idSnippet.set(item.id.videoId, item.snippet);
        // api bug for /search, quote in title is escaped
        item.snippet.title = decodeHtmlEntity(item.snippet.title, {level: 'xml'});
      });

      return result.nextPageToken;
    });
    return idSnippet;
  }

  async getStreamIdLiveDetaildByIds(ids: string[]) {
    const idStreamInfo: Map<
      string,
      {
        scheduledStartAt: Date | null;
        actualStartAt: Date | null;
        actualEndAt: Date | null;
        viewers: number | null;
      }
    > = new Map();
    await parallel(10, arrayByPart(ids, 50), async (videoIds) => {
      await iterPages(async (pageToken) => {
        await costCounter.inc(1);
        const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
          searchParams: {
            part: 'liveStreamingDetails',
            id: videoIds.join(','),
            pageToken: pageToken,
            fields: 'items(id,liveStreamingDetails),nextPageToken',
            key: appConfig.ytToken,
          },
          keepAlive: true,
          responseType: 'json',
        });

        const videosResponse = v.parse(VideosResponseSchema, body);

        videosResponse.items.forEach((item) => {
          if (!item.liveStreamingDetails) return;
          const {scheduledStartTime, actualStartTime, actualEndTime, concurrentViewers} =
            item.liveStreamingDetails;
          let scheduledStartAt = null;
          if (scheduledStartTime) {
            scheduledStartAt = new Date(scheduledStartTime);
          }
          let actualStartAt = null;
          if (actualStartTime) {
            actualStartAt = new Date(actualStartTime);
          }
          let actualEndAt = null;
          if (actualEndTime) {
            actualEndAt = new Date(actualEndTime);
          }
          let viewers: null | number = parseInt(concurrentViewers!, 10);
          if (!isFinite(viewers)) {
            viewers = null;
          }
          idStreamInfo.set(item.id, {
            scheduledStartAt,
            actualStartAt,
            actualEndAt,
            viewers,
          });
        });

        return videosResponse.nextPageToken;
      });
    });
    return idStreamInfo;
  }

  async getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    await parallel(10, arrayByPart(ids, 50), async (ids) => {
      await iterPages(async (pageToken) => {
        await costCounter.inc(1);
        const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
          searchParams: {
            part: 'id',
            id: ids.join(','),
            pageToken: pageToken,
            maxResults: 50,
            fields: 'items/id,nextPageToken',
            key: appConfig.ytToken,
          },
          keepAlive: true,
          responseType: 'json',
        });

        const channelsItemsId = v.parse(ChannelsItemsIdSchema, body);
        if (channelsItemsId.items) {
          channelsItemsId.items.forEach((item) => {
            resultChannelIds.push(item.id);
          });
        }

        return channelsItemsId.nextPageToken;
      });
    });
    return resultChannelIds;
  }

  async findChannel(query: string) {
    const session = {
      isLiveVideoUrl: false,
    };

    const channelId = await this.getChannelIdByUrl(query)
      .catch((err) => {
        if (err.code === 'IS_NOT_CHANNEL_URL') {
          return this.requestChannelIdByVideoUrl(query, session);
        }
        throw err;
      })
      .catch((err) => {
        if (err.code === 'IS_NOT_VIDEO_URL') {
          return this.requestChannelIdByUserUrl(query);
        }
        throw err;
      })
      .catch((err) => {
        if (err.code === 'IS_NOT_USER_URL') {
          return this.requestChannelIdByQuery(query);
        }
        throw err;
      })
      .then(async (channelId) => {
        if (session.isLiveVideoUrl) return channelId;

        const alreadyExists = await this.main.db.hasChannelByServiceRawId(this, channelId);
        if (alreadyExists) {
          return channelId;
        }

        return this.channelHasBroadcasts(channelId).then(() => channelId);
      });

    await costCounter.inc(100);

    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
      searchParams: {
        part: 'snippet',
        channelId: channelId,
        maxResults: 1,
        fields: 'items/snippet',
        key: appConfig.ytToken,
      },
      keepAlive: true,
      responseType: 'json',
    });

    const searchItemsSnippet = v.parse(SearchItemsSnippetSchema, body);
    if (!searchItemsSnippet.items.length) {
      throw new ErrorWithCode('Channel is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
    }

    const snippet = searchItemsSnippet.items[0].snippet;
    const title = snippet.channelTitle;
    const id = snippet.channelId;
    const url = getChannelUrl(id);

    return {id, title, url};
  }

  async getChannelIdByUrl(url: string) {
    let channelId = '';
    [/youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = m[1];
        return true;
      }
    });

    if (!channelId) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    if (!/^UC/.test(channelId)) {
      throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
    }

    return channelId;
  }

  async requestChannelIdByVideoUrl(url: string, session: {isLiveVideoUrl?: boolean} = {}) {
    let videoId = '';
    [
      /youtu\.be\/([\w\-]+)/i,
      /youtube\.com\/.+[?&]v=([\w\-]+)/i,
      /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i,
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        videoId = m[1];
        return true;
      }
    });

    if (!videoId) {
      throw new ErrorWithCode('Is not video url', 'IS_NOT_VIDEO_URL');
    }

    await costCounter.inc(1);

    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
      searchParams: {
        part: 'snippet,liveStreamingDetails',
        id: videoId,
        maxResults: 1,
        fields: 'items(snippet/channelId,liveStreamingDetails)',
        key: appConfig.ytToken,
      },
      keepAlive: true,
      responseType: 'json',
    });

    const videosItemsSnippet = v.parse(VideosItemsSnippetSchema, body);
    if (!videosItemsSnippet.items.length) {
      throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
    }

    const firstItem = videosItemsSnippet.items[0];

    if (firstItem.liveStreamingDetails) {
      session.isLiveVideoUrl = true;
    }

    return firstItem.snippet.channelId;
  }

  async requestChannelIdByUserUrl(url: string) {
    let username = '';
    [
      /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
      /youtube\.com\/c\/([\w\-]+)/i,
      /youtube\.com\/([\w\-]+)/i,
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        username = m[1];
        return true;
      }
    });

    if (!username) {
      throw new ErrorWithCode('Is not user url', 'IS_NOT_USER_URL');
    }

    if (!/^[\w\-]+$/.test(username)) {
      throw new ErrorWithCode('Incorrect username', 'INCORRECT_USERNAME');
    }

    await costCounter.inc(1);

    try {
      const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
        searchParams: {
          part: 'snippet',
          forUsername: username,
          maxResults: 1,
          fields: 'items/id',
          key: appConfig.ytToken,
        },
        keepAlive: true,
        responseType: 'json',
      });

      const channelsItemsId = v.parse(ChannelsItemsIdSchema, body);
      if (!channelsItemsId.items || !channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'CHANNEL_BY_USER_IS_NOT_FOUND') {
        return this.requestChannelIdByQuery(username);
      }
      throw err;
    }
  }

  async requestChannelIdByQuery(query: string) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY');
    }

    await costCounter.inc(100);

    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
      searchParams: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: appConfig.ytToken,
      },
      keepAlive: true,
      responseType: 'json',
    });

    const searchItemsId = v.parse(SearchItemsIdSchema, body);
    if (!searchItemsId.items.length) {
      throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
    }

    return searchItemsId.items[0].id.channelId;
  }

  async channelHasBroadcasts(channelId: string) {
    for (const type of ['completed', 'live', 'upcoming']) {
      await costCounter.inc(100);

      const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
        searchParams: {
          part: 'snippet',
          channelId: channelId,
          eventType: type,
          maxResults: 1,
          order: 'date',
          safeSearch: 'none',
          type: 'video',
          fields: 'items(id/videoId)',
          key: appConfig.ytToken,
        },
        keepAlive: true,
        responseType: 'json',
      });

      const result = v.parse(SearchItemsIdVideoIdSchema, body);

      if (result.items.length) {
        return true;
      }
    }

    throw new ErrorWithCode(`Channel don't have any broadcasts`, 'CHANNEL_BROADCASTS_IS_NOT_FOUND');
  }
}

function getVideoUrl(videoId: string) {
  return 'https://youtu.be/' + encodeURIComponent(videoId);
}

function getChannelUrl(channelId: string) {
  return 'https://youtube.com/channel/' + encodeURIComponent(channelId);
}

function isDailyLimitExceeded(err: HTTPError) {
  if (
    err.name === 'HTTPError' &&
    err.response.statusCode === 403 &&
    err.response.body &&
    err.response.body.error &&
    err.response.body.error.code === 403 &&
    /Daily Limit Exceeded/.test(err.response.body.error.message)
  ) {
    return true;
  }
  return false;
}

function iterPages(callback: (pageToken?: string) => Promise<string | undefined>) {
  let limit = 100;
  const getPage = async (pageToken?: string): Promise<void> => {
    const nextPageToken = await callback(pageToken);
    if (nextPageToken) {
      if (--limit < 0) {
        throw new ErrorWithCode(`Page limit reached`, 'PAGE_LIMIT_REACHED');
      }
      return getPage(nextPageToken);
    }
  };
  return getPage();
}

export default Youtube;
