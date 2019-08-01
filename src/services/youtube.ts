import {ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import RateLimit from "../tools/rateLimit";
import parallel from "../tools/parallel";
import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import arrayByPart from "../tools/arrayByPart";
import withRetry from "../tools/withRetry";
import promiseTry from "../tools/promiseTry";

const got = require('got');
const debug = require('debug')('app:Youtube');

const limit = new RateLimit(1000);
const gotLimited = limit.wrap(got);

interface VideosItemsSnippet {
  items: {
    snippet: {
      channelId: string
    }
  }[]
}

const VideosItemsSnippet:(any: any) => VideosItemsSnippet = struct(struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string'
    })
  })]
}));

interface ChannelsItemsId {
  items: {
    id: string,
  }[],
  nextPageToken: string,
}

const ChannelsItemsId:(any: any) => ChannelsItemsId = struct(struct.partial({
  items: [struct.partial({
    id: 'string'
  })],
  nextPageToken: 'string?'
}));

interface SearchItemsId {
  items: {
    id: {
      channelId: string
    }
  }[]
}

const SearchItemsId:(any: any) => SearchItemsId = struct(struct.partial({
  items: [struct.partial({
    id: struct.partial({
      channelId: 'string'
    })
  })]
}));

interface SearchItemsIdVideoId {
  items: {
    id: {
      videoId: string
    }
  }[]
}

const SearchItemsIdVideoId:(any: any) => SearchItemsIdVideoId = struct(struct.partial({
  items: [struct.partial({
    id: struct.partial({
      videoId: 'string'
    })
  })]
}));

interface SearchItemsSnippet {
  items: {
    snippet: {
      channelId: string,
      channelTitle: string,
    }
  }[]
}

const SearchItemsSnippet:(any: any) => SearchItemsSnippet = struct(struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string',
      channelTitle: 'string'
    })
  })]
}));

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
  }[]
}

const SearchVideoResponse: (any: any) => SearchVideoResponse = struct(struct.partial({
  items: [struct.partial({
    id: struct.partial({
      videoId: 'string',
    }),
    snippet: struct.partial({
      title: 'string',
      liveBroadcastContent: 'string',
      publishedAt: 'string',
      channelTitle: 'string',
      channelId: 'string',
    }),
  })]
}));

interface VideosResponse {
  items: {
    id: string,
    liveStreamingDetails?: {
      actualStartTime?: string,
      actualEndTime?: string,
      concurrentViewers?: string,
    }
  }[],
  nextPageToken?: string
}

const VideosResponse: (any: any) => VideosResponse = struct(struct.partial({
  items: [struct.partial({
    id: 'string',
    liveStreamingDetails: struct.optional(struct.partial({
      actualStartTime: 'string?',
      actualEndTime: 'string?',
      concurrentViewers: 'string?',
    })),
  })],
  nextPageToken: 'string?'
}));

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
    return promiseTry(() => {
      const idSnippet = new Map();
      return parallel(10, channelIds, (channelId) => {
        return withRetry({count: 3, timeout: 250}, () => {
          return gotLimited('https://www.googleapis.com/youtube/v3/search', {
            query: {
              part: 'snippet',
              channelId: channelId,
              eventType: 'live',
              maxResults: 5,
              order: 'date',
              safeSearch: 'none',
              type: 'video',
              fields: 'items(id/videoId,snippet)',
              key: this.main.config.ytToken,
            },
            json: true
          });
        }, isDailyLimitExceeded).then(({body}) => {
          const result = SearchVideoResponse(body);
          result.items.forEach((item) => {
            idSnippet.set(item.id.videoId, item.snippet);
          });
        }).catch((err) => {
          debug(`getStreams for channel (%s) skip, cause: %o`, channelId, err);
          skippedChannelIds.push(channelId);
        });
      }).then(() => idSnippet);
    }).then((idSnippet) => {
      const results:{id: string, viewers: number|null, snippet: SearchVideoResponseSnippet}[] = [];
      return parallel(10, arrayByPart(Array.from(idSnippet.keys()), 50), (videoIds) => {
        return iterPages((pageToken?) => {
          return withRetry({count: 3, timeout: 250}, () => {
            return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
              query: {
                part: 'liveStreamingDetails',
                id: videoIds.join(','),
                pageToken: pageToken,
                fields: 'items(id,liveStreamingDetails),nextPageToken',
                key: this.main.config.ytToken
              },
              json: true,
            });
          }, isDailyLimitExceeded).then(({body}) => {
            const videosResponse = VideosResponse(body);

            videosResponse.items.forEach((item) => {
              if (!item.liveStreamingDetails) return;

              const snippet = idSnippet.get(item.id);
              if (!snippet) {
                debug('Skip video %s, cause: snippet is not found', item.id);
                return;
              }

              const {actualStartTime, actualEndTime, concurrentViewers} = item.liveStreamingDetails;
              if (actualStartTime && !actualEndTime) {
                let viewers = parseInt(concurrentViewers, 10);
                if (!isFinite(viewers)) {
                  viewers = null;
                }
                results.push({
                  id: item.id,
                  viewers: viewers,
                  snippet: snippet
                });
              }
            });

            return videosResponse.nextPageToken;
          });
        });
      }).then(() => results);
    }).then((results) => {
      results.forEach(({id, snippet, viewers}) => {
        if (snippet.liveBroadcastContent !== 'live') return;

        const previews = ['maxresdefault_live', 'sddefault_live', 'hqdefault_live', 'mqdefault_live', 'default_live'].map((quality) => {
          return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
        });

        resultStreams.push({
          id: id,
          game: null,
          isRecord: false,
          previews: previews,
          title: snippet.title,
          url: getVideoUrl(id),
          viewers: viewers,
          channelId: snippet.channelId,
          channelTitle: snippet.channelTitle,
        });
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  getStreamsByIds(ids: string[]) {
    const streamIds: string[] = [];
    const onlineIds: string[] = [];
    return parallel(10, arrayByPart(ids, 50), (videoIds) => {
      return iterPages((pageToken?) => {
        return withRetry({count: 3, timeout: 250}, () => {
          return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
            query: {
              part: 'liveStreamingDetails',
              id: videoIds.join(','),
              pageToken: pageToken,
              fields: 'items(id,liveStreamingDetails),nextPageToken',
              key: this.main.config.ytToken
            },
            json: true,
          });
        }, isDailyLimitExceeded).then(({body}) => {
          const videosResponse = VideosResponse(body);

          videosResponse.items.forEach((item) => {
            if (!item.liveStreamingDetails) return;
            streamIds.push(item.id);

            const {actualStartTime, actualEndTime} = item.liveStreamingDetails;
            if (actualStartTime && !actualEndTime) {
              const startDate = new Date(actualStartTime);
              if (startDate.getTime() < Date.now()) {
                onlineIds.push(item.id);
              }
            }
          });

          return videosResponse.nextPageToken;
        });
      });
    }).then(() => {
      return {streamIds, onlineIds};
    });
  }

  getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    return parallel(10, arrayByPart(ids, 50), (ids) => {
      return iterPages((pageToken?) => {
        return withRetry({count: 3, timeout: 250}, () => {
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
          });
        }, isDailyLimitExceeded).then(({body}) => {
          const channelsItemsId = ChannelsItemsId(body);
          channelsItemsId.items.forEach((item) => {
            resultChannelIds.push(item.id);
          });

          return channelsItemsId.nextPageToken;
        });
      });
    }).then(() => resultChannelIds);
  }

  findChannel(query: string) {
    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return this.requestChannelIdByVideoUrl(query);
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
    }).then((channelId) => {
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

  async requestChannelIdByVideoUrl(url: string) {
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
        part: 'snippet',
        id: videoId,
        maxResults: 1,
        fields: 'items/snippet',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const videosItemsSnippet = VideosItemsSnippet(body);
      if (!videosItemsSnippet.items.length) {
        throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
      }

      return videosItemsSnippet.items[0].snippet.channelId;
    });
  }

  async requestChannelIdByUserUrl(url: string) {
    let username = null;
    [
      /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
      /youtube\.com\/([\w\-]+)/i
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
      if (!channelsItemsId.items.length) {
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