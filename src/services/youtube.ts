import {ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import RateLimit from "../tools/rateLimit";
import parallel from "../tools/parallel";
import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import arrayByPart from "../tools/arrayByPart";
import promiseTry from "../tools/promiseTry";
import got from "../tools/gotWithTimeout";

const debug = require('debug')('app:Youtube');
const XmlEntities = require('html-entities/lib/xml-entities').XmlEntities;

const limit = new RateLimit(1000);
const gotLimited = limit.wrap(got);
const xmlEntities = new XmlEntities();

interface VideosItemsSnippet {
  items: {
    snippet: {
      channelId: string
    },
    liveStreamingDetails?: {
      scheduledStartTime?: string,
      actualStartTime?: string,
      actualEndTime?: string,
      concurrentViewers?: string,
    }
  }[]
}

const VideosItemsSnippet:(any: any) => VideosItemsSnippet = struct.pick({
  items: [struct.pick({
    snippet: struct.pick({
      channelId: 'string'
    }),
    liveStreamingDetails: struct.optional(struct.pick({
      scheduledStartTime: 'string?',
      actualStartTime: 'string?',
      actualEndTime: 'string?',
      concurrentViewers: 'string?',
    })),
  })]
});

interface ChannelsItemsId {
  items?: {
    id: string,
  }[],
  nextPageToken: string,
}

const ChannelsItemsId:(any: any) => ChannelsItemsId = struct.pick({
  items: struct.optional([struct.pick({
    id: 'string'
  })]),
  nextPageToken: 'string?'
});

interface SearchItemsId {
  items: {
    id: {
      channelId: string
    }
  }[]
}

const SearchItemsId:(any: any) => SearchItemsId = struct.pick({
  items: [struct.pick({
    id: struct.pick({
      channelId: 'string'
    })
  })]
});

interface SearchItemsIdVideoId {
  items: {
    id: {
      videoId: string
    }
  }[]
}

const SearchItemsIdVideoId:(any: any) => SearchItemsIdVideoId = struct.pick({
  items: [struct.pick({
    id: struct.pick({
      videoId: 'string'
    })
  })]
});

interface SearchItemsSnippet {
  items: {
    snippet: {
      channelId: string,
      channelTitle: string,
    }
  }[]
}

const SearchItemsSnippet:(any: any) => SearchItemsSnippet = struct.pick({
  items: [struct.pick({
    snippet: struct.pick({
      channelId: 'string',
      channelTitle: 'string'
    })
  })]
});

interface SearchVideoResponseSnippet {
  title: string,
  liveBroadcastContent: string,
  publishedAt: string,
  channelTitle: string,
  channelId: string,
}

interface SearchVideoResponse {
  items: {
    id: {
      videoId: string,
    },
    snippet: SearchVideoResponseSnippet
  }[],
  nextPageToken?: string
}

const SearchVideoResponse: (any: any) => SearchVideoResponse = struct.pick({
  items: [struct.pick({
    id: struct.pick({
      videoId: 'string',
    }),
    snippet: struct.pick({
      title: 'string',
      liveBroadcastContent: 'string',
      publishedAt: 'string',
      channelTitle: 'string',
      channelId: 'string',
    }),
  })],
  nextPageToken: 'string?'
});

interface VideosResponse {
  items: {
    id: string,
    liveStreamingDetails?: {
      scheduledStartTime?: string,
      actualStartTime?: string,
      actualEndTime?: string,
      concurrentViewers?: string,
    }
  }[],
  nextPageToken?: string
}

const VideosResponse: (any: any) => VideosResponse = struct.pick({
  items: [struct.pick({
    id: 'string',
    liveStreamingDetails: struct.optional(struct.pick({
      scheduledStartTime: 'string?',
      actualStartTime: 'string?',
      actualEndTime: 'string?',
      concurrentViewers: 'string?',
    })),
  })],
  nextPageToken: 'string?'
});

class Youtube implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  batchSize: number;
  constructor(main: Main) {
    this.main = main;
    this.id = 'youtube';
    this.name = 'Youtube';
    this.batchSize = 50;
  }

  match(url: string) {
    return [
      /youtu\.be\//i,
      /youtube\.com\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: string[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: string[] = [];
    const removedChannelIds: string[] = [];
    return this.main.ytPubSub.getStreams(channelIds, skippedChannelIds).then((streams) => {
      streams.forEach(({id, title, viewers, channelId, channelTitle}) => {
        const previews = ['maxresdefault_live', 'sddefault_live', 'hqdefault_live', 'mqdefault_live', 'default_live'].map((quality) => {
          return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
        });

        resultStreams.push({
          id: id,
          game: null,
          isRecord: false,
          previews: previews,
          title: title,
          url: getVideoUrl(id),
          viewers: viewers,
          channelId: channelId,
          channelTitle: channelTitle,
          channelUrl: getChannelUrl(channelId),
        });
      });
    }, (err) => {
      debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
      skippedChannelIds.push(...channelIds);
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  getStreamIdSnippetByChannelId(channelId: string, isUpcoming = false) {
    const idSnippet: Map<string, SearchVideoResponseSnippet> = new Map();
    return iterPages((pageToken?) => {
      const query = {
        part: 'snippet',
        channelId: channelId,
        pageToken: pageToken,
        eventType: 'live',
        maxResults: 50,
        order: 'date',
        safeSearch: 'none',
        type: 'video',
        fields: 'items(id/videoId,snippet),nextPageToken',
        key: this.main.config.ytToken,
      };

      if (isUpcoming) {
        query.eventType = 'upcoming';
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - 7);
        // @ts-ignore
        query.publishedAfter = minDate.toISOString();
      }

      return gotLimited('https://www.googleapis.com/youtube/v3/search', {
        query,
        json: true
      }).then(({body}) => {
        const result = SearchVideoResponse(body);

        result.items.forEach((item) => {
          idSnippet.set(item.id.videoId, item.snippet);
          // api bug for /search, quote in title is escaped
          item.snippet.title = xmlEntities.decode(item.snippet.title);
        });

        return result.nextPageToken;
      });
    }).then(() => idSnippet);
  }

  getStreamIdLiveDetaildByIds(ids: string[]) {
    const idStreamInfo: Map<string, {scheduledStartAt: Date|null, actualStartAt: Date|null, actualEndAt: Date|null, viewers: number|null}> = new Map();
    return parallel(10, arrayByPart(ids, 50), (videoIds) => {
      return iterPages((pageToken?) => {
        return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
          query: {
            part: 'liveStreamingDetails',
            id: videoIds.join(','),
            pageToken: pageToken,
            fields: 'items(id,liveStreamingDetails),nextPageToken',
            key: this.main.config.ytToken
          },
          json: true,
        }).then(({body}) => {
          const videosResponse = VideosResponse(body);

          videosResponse.items.forEach((item) => {
            if (!item.liveStreamingDetails) return;
            const {scheduledStartTime, actualStartTime, actualEndTime, concurrentViewers} = item.liveStreamingDetails;
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
            let viewers = parseInt(concurrentViewers, 10);
            if (!isFinite(viewers)) {
              viewers = null;
            }
            idStreamInfo.set(item.id, {
              scheduledStartAt,
              actualStartAt,
              actualEndAt,
              viewers
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
      return iterPages((pageToken?) => {
        return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
          query: {
            part: 'id',
            id: ids.join(','),
            pageToken: pageToken,
            maxResults: 50,
            fields: 'items/id,nextPageToken',
            key: this.main.config.ytToken
          },
          json: true,
        }).then(({body}) => {
          const channelsItemsId = ChannelsItemsId(body);
          channelsItemsId.items && channelsItemsId.items.forEach((item) => {
            resultChannelIds.push(item.id);
          });

          return channelsItemsId.nextPageToken;
        });
      });
    }).then(() => resultChannelIds);
  }

  findChannel(query: string) {
    const session = {
      isLiveVideoUrl: false,
    };

    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return this.requestChannelIdByVideoUrl(query, session);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_VIDEO_URL') {
        return this.requestChannelIdByUserUrl(query);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_USER_URL') {
        return this.requestChannelIdByQuery(query);
      }
      throw err;
    }).then(async (channelId) => {
      if (session.isLiveVideoUrl) return channelId;

      const alreadyExists = await this.main.db.hasChannelByServiceRawId(this, channelId);
      if (alreadyExists) {
        return channelId;
      }

      return this.channelHasBroadcasts(channelId).then(() => channelId);
    }).then((channelId: string) => {
      return gotLimited('https://www.googleapis.com/youtube/v3/search', {
        query: {
          part: 'snippet',
          channelId: channelId,
          maxResults: 1,
          fields: 'items/snippet',
          key: this.main.config.ytToken
        },
        json: true,
      }).then(({body}) => {
        const searchItemsSnippet = SearchItemsSnippet(body);
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
    let channelId = null;
    [
      /youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i
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

    if (!/^UC/.test(channelId)) {
      throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
    }

    return channelId;
  }

  async requestChannelIdByVideoUrl(url: string, session: {isLiveVideoUrl?: boolean} = {}) {
    let videoId = null;
    [
      /youtu\.be\/([\w\-]+)/i,
      /youtube\.com\/.+[?&]v=([\w\-]+)/i,
      /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i
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

    return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
      query: {
        part: 'snippet,liveStreamingDetails',
        id: videoId,
        maxResults: 1,
        fields: 'items(snippet/channelId,liveStreamingDetails)',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const videosItemsSnippet = VideosItemsSnippet(body);
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
    let username = null;
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

    return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
      query: {
        part: 'snippet',
        forUsername: username,
        maxResults: 1,
        fields: 'items/id',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const channelsItemsId = ChannelsItemsId(body);
      if (!channelsItemsId.items || !channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    });
  }

  async requestChannelIdByQuery(query: string) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY')
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/search', {
      query: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const searchItemsId = SearchItemsId(body);
      if (!searchItemsId.items.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }

      return searchItemsId.items[0].id.channelId;
    });
  }

  async channelHasBroadcasts(channelId: string) {
    for (const type of ['completed', 'live', 'upcoming']) {
      const result = await gotLimited('https://www.googleapis.com/youtube/v3/search', {
        query: {
          part: 'snippet',
          channelId: channelId,
          eventType: type,
          maxResults: 1,
          order: 'date',
          safeSearch: 'none',
          type: 'video',
          fields: 'items(id/videoId)',
          key: this.main.config.ytToken
        },
        json: true
      }).then(({body}) => SearchItemsIdVideoId(body));

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

function isDailyLimitExceeded(err: any) {
  if (err.name === 'HTTPError' && err.statusCode === 403 && err.body && err.body.error && err.body.error.code === 403 && /Daily Limit Exceeded/.test(err.body.error.message)) {
    return true;
  }
  return false;
}

function iterPages(callback: (pageToken?: string) => Promise<string|undefined>):Promise<void> {
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