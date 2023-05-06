import {ServiceChannel, ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import * as s from "superstruct";
import ErrorWithCode from "../tools/errorWithCode";
import parallel from "../tools/parallel";
import fetchRequest, {FetchRequestOptions, HTTPError} from "../tools/fetchRequest";

const debug = require('debug')('app:Wasd');

const ChannelInfo = s.object({
  result: s.object({
    channel: s.object({
      channel_id: s.number(),
      channel_name: s.string(),
      channel_is_live: s.boolean(),
    }),
    media_container: s.nullable(s.object({
      media_container_id: s.number(),
      media_container_name: s.string(),
      media_container_status: s.string(), // RUNNING
      channel_id: s.number(),
      created_at: s.string(),
      published_at: s.string(),
      game: s.object({
        game_name: s.string(),
      }),
      media_container_streams: s.array(s.object({
        stream_id: s.number(),
        stream_current_viewers: s.number(),
        stream_media: s.array(s.object({
          media_status: s.string(), // RUNNING
          media_meta: s.object({
            media_preview_url: s.string(),
          }),
        })),
      })),
    }))
  })
});

class Wasd implements ServiceInterface {
  id = 'wasd';
  name = 'Wasd';
  batchSize = 100;
  noCachePreview = true;

  constructor(public main: Main) {
  }

  match(url: string) {
    return [
      /wasd\.tv\/[^\/]+/i
    ].some(re => re.test(url));
  }

  async getStreams(channelIds: number[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: number[] = [];
    const removedChannelIds: number[] = [];
    await parallel(10, channelIds, async (channelId) => {
      try {
        const {channel, media_container} = await this.getChannelInfoById(channelId);
        if (!media_container) return;

        const {channel_id, channel_name, channel_is_live} = channel;
        if (!channel_is_live) return;

        const {
          media_container_status,
          media_container_name,
          media_container_streams,
          channel_id: media_container_channel_id,
        } = media_container;

        if (media_container_status !== 'RUNNING') return;

        media_container_streams.forEach((stream) => {
          if (media_container_channel_id !== channel_id) return;

          const previews: string[] = [];
          stream.stream_media.some((media) => {
            if (media.media_status === 'RUNNING' && media.media_meta.media_preview_url) {
              previews.push(String(media.media_meta.media_preview_url).slice(0, 1024));
              return true;
            }
          });

          resultStreams.push({
            id: stream.stream_id,
            url: getChannelUrl(channel_name),
            title: media_container_name,
            game: null,
            isRecord: false,
            previews: previews,
            viewers: stream.stream_current_viewers,
            channelId: channel_id,
            channelTitle: channel_name,
            channelUrl: getChannelUrl(channel_name),
          });
        });
      } catch (err) {
        debug(`getStream for channel (%j) skip, cause: %o`, channelId, err);
        if (['CHANNEL_IS_BANNED', 'CHANNEL_BY_ID_IS_NOT_FOUND'].includes((err as ErrorWithCode).code)) {
          removedChannelIds.push(channelId);
        } else {
          skippedChannelIds.push(channelId);
        }
      }
    });
    return {streams: resultStreams, skippedChannelIds, removedChannelIds};
  }

  async getExistsChannelIds(ids: number[]) {
    const resultChannelIds: number[] = [];
    await parallel(10, ids, async (channelId) => {
      try {
        await this.getChannelInfoById(channelId);
        resultChannelIds.push(channelId);
      } catch (err) {
        if (['CHANNEL_IS_BANNED', 'CHANNEL_BY_ID_IS_NOT_FOUND'].includes((err as ErrorWithCode).code)) {
          // pass
        } else {
          debug('requestChannelById (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
        }
      }
    });
    return resultChannelIds;
  }

  async findChannel(query: string): Promise<ServiceChannel> {
    const {channel} = await this.getChannelIdByUrl(query).then((channelId) => {
      return this.getChannelInfoById(channelId);
    }, (err) => {
      if (err.code !== 'IS_NOT_CHANNEL_URL') {
        throw err;
      }

      return this.getChannelNameByUrl(query).catch((err) => {
        if (err.code !== 'IS_NOT_CHANNEL_URL') {
          throw err;
        }

        return query;
      }).then((query) => {
        return this.getChannelInfoByName(query);
      });
    });

    const id = channel.channel_id;
    const title = channel.channel_name;
    const url = getChannelUrl(title);
    return {id, title, url};
  }

  async getChannelInfoById(channel_id: number) {
    return this.getChannelInfo({channel_id});
  }

  async getChannelInfoByName(channel_name: string) {
    return this.getChannelInfo({channel_name});
  }

  async getChannelInfo(payload: { channel_name: string } | { channel_id: number }) {
    const query = (new URLSearchParams(payload as Record<string, string>)).toString();
    try {
      const {body} = await fetchRequest('https://wasd.tv/api/v2/broadcasts/public?' + query, this.sign({
        responseType: 'json',
        keepAlive: true,
      }));
      return s.mask(body, ChannelInfo).result;
    } catch (err) {
      const error = err as HTTPError;
      if (error.name === 'HTTPError') {
        if (error.response.statusCode === 404) {
          throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
        }
        if (error.response.statusCode === 403) {
          throw new ErrorWithCode('Channel is banned', 'CHANNEL_IS_BANNED');
        }
      }
      throw err;
    }
  }

  async getChannelNameByUrl(url: string) {
    let channelId = '';
    [
      /wasd\.tv\/([^\/]+)/i
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

  async getChannelIdByUrl(url: string) {
    let channelId: number | null = null;
    [
      /wasd\.tv\/channel\/(\d+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = parseInt(m[1], 10);
        return true;
      }
    });
    if (!channelId) {
      throw new ErrorWithCode('Is not channel id url', 'IS_NOT_CHANNEL_URL');
    }

    return channelId!;
  }

  sign(options: FetchRequestOptions = {}) {
    return {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Token ${this.main.config.wasdToken}`,
      }
    };
  }
}

function getChannelUrl(channelName: string) {
  return 'https://wasd.tv/' + encodeURIComponent(channelName);
}

export default Wasd;
