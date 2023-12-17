import {Infer} from 'superstruct';
import {ServiceChannel, ServiceGetStreamsResult, ServiceInterface, ServiceStream} from '../checker';
import ErrorWithCode from '../tools/errorWithCode';
import fetchRequest, {HTTPError} from '../tools/fetchRequest';
import * as s from 'superstruct';
import parallel from '../tools/parallel';
import {getDebug} from '../tools/getDebug';
import arrayByPart from '../tools/arrayByPart';
import Main from '../main';

const debug = getDebug('app:vkplay');

const BlogOwnerStrict = s.object({
  displayName: s.string(),
  // name: s.string(),
  // nick: s.string(),
  // id: s.number(),
});

const SearchBlogStrict = s.object({
  /* owner: BlogOwnerStrict, */
  blogUrl: s.string(),
});
type SearchBlog = Infer<typeof SearchBlogStrict>;

const SearchStrict = s.object({
  data: s.object({
    searchBlogs: s.array(
      s.object({
        blog: s.optional(SearchBlogStrict),
      }),
    ),
  }),
});

const BlogStrict = s.object({
  owner: BlogOwnerStrict,
  blogUrl: s.string(),
});

const StreamStruct = s.object({
  title: s.string(),
  // isEnded: s.boolean(),
  count: s.object({
    viewers: s.number(),
  }),
  user: s.object({
    displayName: s.string(),
  }),
  startTime: s.optional(s.number()), // unixtimestamp
  id: s.string(),
  // createdAt: s.number(),
  previewUrl: s.string(),
  isOnline: s.boolean(),
  category: s.object({
    // type: s.string(),
    title: s.string(),
  }),
});

class Vkplay implements ServiceInterface {
  id = 'vkplay';
  name = 'vkplayLive';
  batchSize = 10;
  streamPreviewHeadUnsupported = true;

  constructor(public main: Main) {}

  match(query: string): boolean {
    return [/vkplay\.live\//i].some((re) => re.test(query));
  }

  async getStreams(channelIds: string[]): Promise<ServiceGetStreamsResult> {
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
        skippedChannelIds.push(channelId);
      }
    });
    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async fetchStreamInfo(channelId: string) {
    const {body} = await fetchRequest(
      `https://api.vkplay.live/v1/blog/${encodeURIComponent(channelId)}/public_video_stream`,
      {
        keepAlive: true,
        responseType: 'json',
      },
    ).catch((error) => {
      const err = error as HTTPError;
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });

    const stream = s.mask(body, StreamStruct);

    if (!stream.isOnline) return;

    const previews: string[] = [];
    if (stream.previewUrl) {
      previews.push(stream.previewUrl);
    }

    return {
      id: stream.id,
      url: getBlogUrl(channelId),
      title: stream.title,
      game: stream.category.title,
      isRecord: false,
      previews,
      viewers: stream.count.viewers,
      channelId: channelId,
      channelTitle: stream.user.displayName,
      channelUrl: getBlogUrl(channelId),
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
        return this.findChannelIdByQuery(query);
      }
      throw err;
    });
    return this.fetchChannelInfo(channelId);
  }

  async getChannelIdByUrl(url: string) {
    let channelId = '';
    [/vkplay\.live\/([\w\-]+)/i].some((re) => {
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

  async findChannelIdByQuery(query: string) {
    const {body} = await fetchRequest(
      'https://api.vkplay.live/v1/search/public_video_stream/blog/',
      {
        searchParams: {
          search_query: query,
          limit: 5,
        },
        keepAlive: true,
        responseType: 'json',
      },
    );

    const stream = s.mask(body, SearchStrict);
    let firstBlog: SearchBlog | undefined;
    stream.data.searchBlogs.some(({blog}) => {
      if (blog) {
        firstBlog = blog;
        return true;
      }
      return false;
    });
    if (!firstBlog) {
      throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
    }
    return firstBlog.blogUrl;
  }

  async fetchChannelInfo(channelId: string) {
    const {body} = await fetchRequest(
      'https://api.vkplay.live/v1/blog/' + encodeURIComponent(channelId),
      {
        keepAlive: true,
        responseType: 'json',
      },
    ).catch((error) => {
      const err = error as HTTPError;
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });

    const blog = s.mask(body, BlogStrict);
    const id = blog.blogUrl;
    const url = getBlogUrl(blog.blogUrl);
    const title = blog.owner.displayName;
    return {id, title, url};
  }
}

function getBlogUrl(name: string) {
  return `https://vkplay.live/${encodeURIComponent(name)}`;
}

export default Vkplay;
