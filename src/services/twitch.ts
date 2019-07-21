import {ServiceInterface, StreamInterface} from "../checker";
import Main from "../main";
import parallel from "../tools/parallel";
import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import arrayByPart from "../tools/arrayByPart";
import withRetry from "../tools/withRetry";
import noCacheUrl from "../tools/noCacheUrl";

const got = require('got');
const debug = require('debug')('app:Twitch');

interface Channels {
  channels: {
    _id: number,
    name: string,
    display_name: string,
    url: string,
  }[]
}

const Channels:(any) => Channels = struct(struct.partial({
  channels: [struct.partial({
    _id: 'number',
    name: 'string',
    display_name: 'string',
    url: 'string',
  })]
}));

interface Streams {
  streams: {
    _id: number,
    stream_type: string,
    preview: {[s: string]: string},
    viewers: number,
    game: string,
    created_at: string,
    channel: {
      _id: number,
      name: string,
      display_name: string,
      status: string,
      url: string,
    }
  }[]
}

const Streams: (any) => Streams = struct(struct.partial({
  streams: [struct.partial({
    _id: 'number',
    stream_type: 'string',
    preview: struct.dict(['string', 'string']),
    viewers: 'number',
    game: 'string',
    created_at: 'string',
    channel: struct.partial({
      _id: 'number',
      name: 'string',
      display_name: 'string',
      status: 'string',
      url: 'string',
    })
  })]
}));

class Twitch implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  constructor(main: Main) {
    this.main = main;
    this.id = 'twitch';
    this.name = 'Twitch';
  }

  match(url: string) {
    return [
      /twitch\.tv\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: number[]) {
    const resultStreams: StreamInterface[] = [];
    const skippedChannelIds = [];
    const removedChannelIds = [];
    return parallel(10, arrayByPart(channelIds, 100), (channelIds) => {
      return withRetry({count: 3, timeout: 250}, () => {
        return got('https://api.twitch.tv/kraken/streams', {
          query: {
            limit: 100,
            channel: channelIds.join(','),
            stream_type: 'all'
          },
          headers: {
            'Accept': 'application/vnd.twitchtv.v5+json',
            'Client-ID': this.main.config.twitchToken
          },
          json: true,
        });
      }).then(({body}) => {
        const streams = Streams(body).streams;

        streams.forEach((stream) => {
          if (!channelIds.includes(stream.channel._id)) {
            debug(`getStreams for channel (%s) skip, cause: Not required`, stream.channel._id);
            return;
          }

          const previews = [];
          ['template', 'large', 'medium'/*, 'small'*/].forEach((size) => {
            let url = stream.preview[size];
            if (url) {
              if (size === 'template') {
                url = url.replace('{width}', '1280').replace('{height}', '720')
              }
              previews.push(noCacheUrl(url));
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
            channelTitle: stream.channel.display_name
          });
        });
      }).catch((err) => {
        debug(`getStreams for channels (%j) skip, cause: %o`, channelIds, err);
        skippedChannelIds.push(...channelIds);
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  async getExistsChannelIds(ids: number[]) {
    const resultChannelIds = [];
    return parallel(10, ids, (channelId) => {
      return this.requestChannelById(channelId).then(() => {
        resultChannelIds.push(channelId);
      }, (err) => {
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
    return got('https://api.twitch.tv/kraken/channels/' + channelId, {
      headers: {
        'Accept': 'application/vnd.twitchtv.v5+json',
        'Client-ID': this.main.config.twitchToken
      },
    }).catch((err) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel by id is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  findChannel(query: string) {
    return this.getChannelNameByUrl(query).then((name) => {
      return JSON.stringify(name);
    }).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return query;
      } else {
        throw err;
      }
    }).then((query) => {
      return this.requestChannelByQuery(query);
    }).then((channel) => {
      const id = channel._id;
      const title = channel.display_name;
      const url = channel.url;
      return {id, title, url};
    });
  }

  requestChannelByQuery(query: string) {
    return got('https://api.twitch.tv/kraken/search/channels', {
      query: {query},
      headers: {
        'Accept': 'application/vnd.twitchtv.v5+json',
        'Client-ID': this.main.config.twitchToken
      },
      json: true,
    }).then(({body}) => {
      const channels = Channels(body).channels;
      if (!channels.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }
      return channels[0];
    });
  }

  getChannelNameByUrl(url: string) {
    let channelId = null;
    [
      /twitch\.tv\/([\w\-]+)/i
    ].some((re: RegExp) => {
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
}

export default Twitch;