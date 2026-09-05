import * as v from 'valibot';
import {ServiceChannel, ServiceGetStreamsResult, ServiceInterface, ServiceStream} from '../checker';
import ErrorWithCode from '../shared/tools/errorWithCode';
import fetchRequest, {HTTPError} from '../shared/tools/fetchRequest';
import parallel from '../shared/tools/parallel';
import {getDebug} from '../shared/tools/getDebug';
import Main from '../main';

const debug = getDebug('app:vkplay');

const BlogOwnerSchema = v.object({
  displayName: v.string(),
  // name: v.string(),
  // nick: v.string(),
  // id: v.number(),
});

const SearchBlogSchema = v.object({
  /* owner: BlogOwnerSchema, */
  blogUrl: v.string(),
});
type SearchBlog = v.InferOutput<typeof SearchBlogSchema>;

const SearchSchema = v.object({
  data: v.object({
    searchBlogs: v.array(
      v.object({
        blog: v.optional(SearchBlogSchema),
      }),
    ),
  }),
});

const BlogSchema = v.object({
  owner: BlogOwnerSchema,
  blogUrl: v.string(),
});

const StreamSchema = v.object({
  title: v.string(),
  // isEnded: v.boolean(),
  count: v.object({
    viewers: v.number(),
  }),
  user: v.object({
    displayName: v.string(),
  }),
  startTime: v.optional(v.number()), // unixtimestamp
  id: v.string(),
  // createdAt: v.number(),
  previewUrl: v.string(),
  isOnline: v.boolean(),
  category: v.optional(
    v.object({
      // type: v.string(),
      title: v.string(),
    }),
  ),
});

class Vkplay implements ServiceInterface<string> {
  id = 'vkplay';
  name = 'vkplayLive';
  batchSize = 10;
  streamPreviewHeadUnsupported = true;

  constructor(public main: Main) {}

  match(query: string): boolean {
    return [/vkplay\.live\//i, /live\.vkvideo\.ru\//].some((re) => re.test(query));
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
      `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channelId)}/public_video_stream`,
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

    const stream = v.parse(StreamSchema, body);

    if (!stream.isOnline) return;

    const previews: string[] = [];
    if (stream.previewUrl) {
      previews.push(stream.previewUrl);
    }

    return {
      id: stream.id,
      url: getBlogUrl(channelId),
      title: stream.title,
      game: stream.category?.title,
      isRecord: false,
      previews: JSON.stringify(previews),
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
    [/vkplay\.live\/([\w\-]+)/i, /live\.vkvideo\.ru\/([\w\-]+)/i].some((re) => {
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
      'https://api.live.vkvideo.ru/v1/search/public_video_stream/blog/',
      {
        searchParams: {
          search_query: query,
          limit: 5,
        },
        keepAlive: true,
        responseType: 'json',
      },
    );

    const stream = v.parse(SearchSchema, body);
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
      'https://api.live.vkvideo.ru/v1/blog/' + encodeURIComponent(channelId),
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

    const blog = v.parse(BlogSchema, body);
    const id = blog.blogUrl;
    const url = getBlogUrl(blog.blogUrl);
    const title = blog.owner.displayName;
    return {id, title, url};
  }
}

function getBlogUrl(name: string) {
  return `https://live.vkvideo.ru/${encodeURIComponent(name)}`;
}

export default Vkplay;
