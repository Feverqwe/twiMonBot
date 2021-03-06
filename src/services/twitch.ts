import {ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import parallel from "../tools/parallel";
import ErrorWithCode from "../tools/errorWithCode";
import * as s from "superstruct";
import arrayByPart from "../tools/arrayByPart";
import fetchRequest, {HTTPError} from "../tools/fetchRequest";

const debug = require('debug')('app:Twitch');

const ChannelsStruct = s.object({
  channels: s.array(s.object({
    _id: s.number(),
    name: s.string(),
    display_name: s.string(),
    url: s.string(),
  })),
});

const StreamsStruct = s.object({
  streams: s.array(s.object({
    _id: s.number(),
    stream_type: s.string(),
    preview: s.record(s.string(), s.string()),
    viewers: s.number(),
    game: s.string(),
    created_at: s.string(),
    channel: s.object({
      _id: s.number(),
      name: s.string(),
      display_name: s.string(),
      status: s.string(),
      url: s.string(),
    })
  }))
});

class Twitch implements ServiceInterface {
  id = 'twitch';
  name = 'Twitch';
  batchSize = 100;
  noCachePreview = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [
      /twitch\.tv\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: number[] = [];
    const removedChannelIds: number[] = [];
    return parallel(10, arrayByPart(channelIds, 100), (channelIds) => {
      return fetchRequest('https://api.twitch.tv/kraken/streams', {
        searchParams: {
          limit: 100,
          channel: channelIds.join(','),
          stream_type: 'all'
        },
        headers: {
          'Accept': 'application/vnd.twitchtv.v5+json',
          'Client-ID': this.main.config.twitchToken
        },
        keepAlive: true,
        responseType: 'json',
      }).then(({body}) => {
        const result = s.mask(body, StreamsStruct);
        const streams = result.streams;

        streams.forEach((stream) => {
          const previews: string[] = [];
          ['template', 'large', 'medium'/*, 'small'*/].forEach((size) => {
            let url = stream.preview[size];
            if (url) {
              if (size === 'template') {
                url = url.replace('{width}', '1920').replace('{height}', '1080')
              }
              previews.push(url);
            }
          });

          resultStreams.push({
            id: stream._id,
            url: stream.channel.url,
            title: stream.channel.status,
            game: stream.game,
            isRecord: stream.stream_type !== 'live',
            previews: previews,
            viewers: stream.viewers,
            channelId: stream.channel._id,
            channelTitle: stream.channel.display_name,
            channelUrl: stream.channel.url,
          });
        });
      }).catch((err: any) => {
        debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
        skippedChannelIds.push(...channelIds);
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  getExistsChannelIds(ids: number[]) {
    const resultChannelIds: number[] = [];
    return parallel(10, ids, (channelId) => {
      return this.requestChannelById(channelId).then(() => {
        resultChannelIds.push(channelId);
      }, (err: any) => {
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          // pass
        } else {
          debug('requestChannelById (%s) error: %o', channelId, err);
          resultChannelIds.push(channelId);
        }
      });
    }).then(() => resultChannelIds);
  }

  requestChannelById(channelId: number) {
    return fetchRequest('https://api.twitch.tv/kraken/channels/' + channelId, {
      headers: {
        'Accept': 'application/vnd.twitchtv.v5+json',
        'Client-ID': this.main.config.twitchToken
      },
      keepAlive: true,
    }).catch((err: HTTPError) => {
      if (err.name === 'HTTPError' && err.response.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  findChannel(query: string) {
    return this.getChannelNameByUrl(query).then((name) => {
      return {query: name, isName: true};
    }).catch((err: any) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return {query, isName: false};
      } else {
        throw err;
      }
    }).then(({query, isName}) => {
      return this.requestChannelByQuery(query, isName);
    }).then((channel) => {
      const id = channel._id;
      const title = channel.display_name;
      const url = channel.url;
      return {id, title, url};
    });
  }

  requestChannelByQuery(query: string, isName: boolean) {
    return fetchRequest('https://api.twitch.tv/kraken/search/channels', {
      searchParams: {query: isName ? JSON.stringify(query) : query, limit: 100},
      headers: {
        'Accept': 'application/vnd.twitchtv.v5+json',
        'Client-ID': this.main.config.twitchToken
      },
      keepAlive: true,
      responseType: 'json',
    }).then(({body}) => {
      const channels = s.mask(body, ChannelsStruct).channels;
      if (!channels.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }
      let result = channels.find((channel) => channel.name === query);
      if (!result) {
        result = channels[0];
      }
      return result;
    });
  }

  async getChannelNameByUrl(url: string) {
    let channelName = '';
    [
      /twitch\.tv\/([\w\-]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelName = m[1];
        return true;
      }
      return false;
    });

    if (!channelName) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    return channelName;
  }
}

export default Twitch;