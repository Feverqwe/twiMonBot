import {ServiceInterface, ServiceStream} from '../checker';
import Main from '../main';
import parallel from '../tools/parallel';
import ErrorWithCode from '../tools/errorWithCode';
import * as s from 'superstruct';
import {Infer} from 'superstruct';
import arrayByPart from '../tools/arrayByPart';
import promiseTry from '../tools/promiseTry';
import fetchRequest, {HTTPError} from '../tools/fetchRequest';
import {decode as decodeHtmlEntity} from 'html-entities';
import ytCostCounter from '../tools/ytCostCounter';
import {appConfig} from '../appConfig';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Youtube');

const costCounter = ytCostCounter(150000);

const VideosItemsSnippetStruct = s.object({
  items: s.array(
    s.object({
      snippet: s.object({
        channelId: s.string(),
      }),
      liveStreamingDetails: s.optional(
        s.object({
          scheduledStartTime: s.optional(s.string()),
          actualStartTime: s.optional(s.string()),
          actualEndTime: s.optional(s.string()),
          concurrentViewers: s.optional(s.string()),
        }),
      ),
    }),
  ),
});

const ChannelsItemsIdStruct = s.object({
  items: s.optional(
    s.array(
      s.object({
        id: s.string(),
      }),
    ),
  ),
  nextPageToken: s.optional(s.string()),
});

const SearchItemsIdStruct = s.object({
  items: s.array(
    s.object({
      id: s.object({
        channelId: s.string(),
      }),
    }),
  ),
});

const SearchItemsIdVideoIdStruct = s.object({
  items: s.array(
    s.object({
      id: s.object({
        videoId: s.string(),
      }),
    }),
  ),
});

const SearchItemsSnippetStruct = s.object({
  items: s.array(
    s.object({
      snippet: s.object({
        channelId: s.string(),
        channelTitle: s.string(),
      }),
    }),
  ),
});

type SearchVideoResponseSnippet = Infer<typeof SearchVideoResponseSnippetStruct>;
const SearchVideoResponseSnippetStruct = s.object({
  title: s.string(),
  liveBroadcastContent: s.string(),
  publishedAt: s.string(),
  channelTitle: s.string(),
  channelId: s.string(),
});

const SearchVideoResponseStruct = s.object({
  items: s.array(
    s.object({
      id: s.object({
        videoId: s.string(),
      }),
      snippet: SearchVideoResponseSnippetStruct,
    }),
  ),
  nextPageToken: s.optional(s.string()),
});

const VideosResponseStruct = s.object({
  items: s.array(
    s.object({
      id: s.string(),
      liveStreamingDetails: s.optional(
        s.object({
          scheduledStartTime: s.optional(s.string()),
          actualStartTime: s.optional(s.string()),
          actualEndTime: s.optional(s.string()),
          concurrentViewers: s.optional(s.string()),
        }),
      ),
    }),
  ),
  nextPageToken: s.optional(s.string()),
});

class Youtube implements ServiceInterface {
  id = 'youtube';
  name = 'Youtube';
  batchSize = 50;
  streamUrlWithoutChannelName = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [/youtu\.be\//i, /youtube\.com\//i].some((re) => re.test(url));
  }

  getStreams(channelIds: string[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: string[] = [];
    const removedChannelIds: string[] = [];
    return this.main.ytPubSub
      .getStreams(channelIds, skippedChannelIds)
      .then(
        (streams) => {
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
              previews: previews,
              title: title,
              url: getVideoUrl(id),
              viewers: normViewers,
              channelId: channelId,
              channelTitle: channelTitle,
              channelUrl: getChannelUrl(channelId),
            });
          });
        },
        (err) => {
          debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
          skippedChannelIds.push(...channelIds);
        },
      )
      .then(() => {
        return {streams: resultStreams, skippedChannelIds, removedChannelIds};
      });
  }

  getStreamIdSnippetByChannelId(channelId: string, isUpcoming = false) {
    const idSnippet: Map<string, SearchVideoResponseSnippet> = new Map();
    return iterPages(async (pageToken?) => {
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
      return fetchRequest('https://www.googleapis.com/youtube/v3/search', {
        searchParams: query,
        keepAlive: true,
        responseType: 'json',
      }).then(({body}) => {
        const result = s.mask(body, SearchVideoResponseStruct);

        result.items.forEach((item) => {
          idSnippet.set(item.id.videoId, item.snippet);
          // api bug for /search, quote in title is escaped
          item.snippet.title = decodeHtmlEntity(item.snippet.title, {level: 'xml'});
        });

        return result.nextPageToken;
      });
    }).then(() => idSnippet);
  }

  getStreamIdLiveDetaildByIds(ids: string[]) {
    const idStreamInfo: Map<
      string,
      {
        scheduledStartAt: Date | null;
        actualStartAt: Date | null;
        actualEndAt: Date | null;
        viewers: number | null;
      }
    > = new Map();
    return parallel(10, arrayByPart(ids, 50), (videoIds) => {
      return iterPages(async (pageToken?) => {
        await costCounter.inc(1);
        return fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
          searchParams: {
            part: 'liveStreamingDetails',
            id: videoIds.join(','),
            pageToken: pageToken,
            fields: 'items(id,liveStreamingDetails),nextPageToken',
            key: appConfig.ytToken,
          },
          keepAlive: true,
          responseType: 'json',
        }).then(({body}) => {
          const videosResponse = s.mask(body, VideosResponseStruct);

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
    }).then(() => idStreamInfo);
  }

  getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    return parallel(10, arrayByPart(ids, 50), (ids) => {
      return iterPages(async (pageToken?) => {
        await costCounter.inc(1);
        return fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
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
        }).then(({body}) => {
          const channelsItemsId = s.mask(body, ChannelsItemsIdStruct);
          if (channelsItemsId.items) {
            channelsItemsId.items.forEach((item) => {
              resultChannelIds.push(item.id);
            });
          }

          return channelsItemsId.nextPageToken;
        });
      });
    }).then(() => resultChannelIds);
  }

  findChannel(query: string) {
    const session = {
      isLiveVideoUrl: false,
    };

    return this.getChannelIdByUrl(query)
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
      })
      .then(async (channelId) => {
        await costCounter.inc(100);
        return fetchRequest('https://www.googleapis.com/youtube/v3/search', {
          searchParams: {
            part: 'snippet',
            channelId: channelId,
            maxResults: 1,
            fields: 'items/snippet',
            key: appConfig.ytToken,
          },
          keepAlive: true,
          responseType: 'json',
        }).then(({body}) => {
          const searchItemsSnippet = s.mask(body, SearchItemsSnippetStruct);
          if (!searchItemsSnippet.items.length) {
            throw new ErrorWithCode('Channel is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
          }

          const snippet = searchItemsSnippet.items[0].snippet;
          const title = snippet.channelTitle;
          const id = snippet.channelId;
          const url = getChannelUrl(id);

          return {id, title, url};
        });
      });
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
    return fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
      searchParams: {
        part: 'snippet,liveStreamingDetails',
        id: videoId,
        maxResults: 1,
        fields: 'items(snippet/channelId,liveStreamingDetails)',
        key: appConfig.ytToken,
      },
      keepAlive: true,
      responseType: 'json',
    }).then(({body}) => {
      const videosItemsSnippet = s.mask(body, VideosItemsSnippetStruct);
      if (!videosItemsSnippet.items.length) {
        throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
      }

      const firstItem = videosItemsSnippet.items[0];

      if (firstItem.liveStreamingDetails) {
        session.isLiveVideoUrl = true;
      }

      return firstItem.snippet.channelId;
    });
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
    return fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
      searchParams: {
        part: 'snippet',
        forUsername: username,
        maxResults: 1,
        fields: 'items/id',
        key: appConfig.ytToken,
      },
      keepAlive: true,
      responseType: 'json',
    })
      .then(({body}) => {
        const channelsItemsId = s.mask(body, ChannelsItemsIdStruct);
        if (!channelsItemsId.items || !channelsItemsId.items.length) {
          throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
        }

        return channelsItemsId.items[0].id;
      })
      .catch((err) => {
        if (err.code === 'CHANNEL_BY_USER_IS_NOT_FOUND') {
          return this.requestChannelIdByQuery(username);
        }
        throw err;
      });
  }

  async requestChannelIdByQuery(query: string) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY');
    }

    await costCounter.inc(100);
    return fetchRequest('https://www.googleapis.com/youtube/v3/search', {
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
    }).then(({body}) => {
      const searchItemsId = s.mask(body, SearchItemsIdStruct);
      if (!searchItemsId.items.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }

      return searchItemsId.items[0].id.channelId;
    });
  }

  async channelHasBroadcasts(channelId: string) {
    for (const type of ['completed', 'live', 'upcoming']) {
      await costCounter.inc(100);
      const result = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
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
      }).then(({body}) => s.mask(body, SearchItemsIdVideoIdStruct));

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
  const getPage = (pageToken?: string): Promise<void> => {
    return promiseTry(() => callback(pageToken)).then((nextPageToken?: string) => {
      if (nextPageToken) {
        if (--limit < 0) {
          throw new ErrorWithCode(`Page limit reached`, 'PAGE_LIMIT_REACHED');
        }
        return getPage(nextPageToken);
      }
    });
  };
  return getPage();
}

export default Youtube;
