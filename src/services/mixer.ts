import Main from "../main";
import {ServiceInterface, ServiceStream} from "../checker";
import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import parallel from "../tools/parallel";
import got from "../tools/gotWithTimeout";

const debug = require('debug')('app:Mixer');

interface Channel {
  id: number,
  token: string,
  name: string,
  online: boolean,
  viewersCurrent: number,
  createdAt: string
}

const Channels:(any: any) => Channel[] = struct([struct.partial({
  id: 'number',
  token: 'string',
  name: 'string',
  online: 'boolean',
  viewersCurrent: 'number',
  createdAt: 'string'
})]);

interface ExtendedChannel extends Channel {
  type?: null|{
    name: string
  }
}

const ExtendedChannel:(any: any) => ExtendedChannel = struct(struct.partial({
  id: 'number',
  token: 'string',
  name: 'string',
  online: 'boolean',
  viewersCurrent: 'number',
  type: struct.optional(struct.union([struct.partial({
    name: 'string'
  }), 'null'])),
  createdAt: 'string'
}));

class Mixer implements ServiceInterface {
  main: Main;
  id: string;
  name: string;
  batchSize: number;
  noCachePreview: boolean;
  constructor(main: Main) {
    this.main = main;
    this.id = 'mixer';
    this.name = 'Mixer';
    this.batchSize = 50;
    this.noCachePreview = true;
  }

  match(url: string) {
    return [
      /mixer\.com\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: string[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: string[] = [];
    const removedChannelIds: string[] = [];
    return parallel(10, channelIds, (channelId) => {
      return got('https://mixer.com/api/v1/channels/' + encodeURIComponent(channelId), {
        headers: {
          'user-agent': ''
        },
        json: true,
      }).then(({body}: {body: any}) => {
        const channel = ExtendedChannel(body);

        if (!channel.online) return;

        const url = getChannelUrl(channel.token);

        let game = null;
        if (channel.type) {
          game = channel.type.name;
        }

        const previews = [
          `https://thumbs.mixer.com/channel/${encodeURIComponent('' + channel.id)}.big.jpg`
        ];

        resultStreams.push({
          id: channel.id,
          url: url,
          title: channel.name,
          game: game,
          isRecord: false,
          previews: previews,
          viewers: channel.viewersCurrent,
          channelId: channel.id,
          channelTitle: channel.token,
          channelUrl: getChannelUrl(channel.token),
        });
      }, (err: any) => {
        if (isNotFoundChannel(err)) {
          removedChannelIds.push(channelId);
        } else {
          debug(`getStreams for channel (%s) skip, cause: %o`, channelId, err);
          skippedChannelIds.push(channelId);
        }
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  async getExistsChannelIds(ids: string[]) {
    return ids;
  }

  findChannel(query: string) {
    return this.getChannelIdByUrl(query).then((channelId) => {
      return this.requestChannelById(channelId);
    }, (err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return this.requestChannelByQuery(query);
      }
      throw err;
    }).then((channel: Channel) => {
      const id = channel.id;
      const title = channel.token;
      const url = getChannelUrl(channel.token);
      return {id, title, url};
    });
  }

  requestChannelByQuery(query: string) {
    return got('https://mixer.com/api/v1/channels', {
      query: {
        limit: 1,
        scope: 'names',
        q: query
      },
      headers: {
        'user-agent': ''
      },
      json: true,
    }).then(({body}: {body: object}) => {
      const channels = Channels(body);
      if (!channels.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }
      return channels[0];
    });
  }

  requestChannelById(channelId: string) {
    return got('https://mixer.com/api/v1/channels/' + encodeURIComponent(channelId), {
      headers: {
        'user-agent': ''
      },
      json: true,
    }).then(({body}: {body: object}) => {
      return ExtendedChannel(body);
    }, (err: any) => {
      if (err.statusCode === 404) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  async getChannelIdByUrl(url: string) {
    let channelId = null;
    [
      /mixer\.com\/([\w\-]+)/i
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

function getChannelUrl(channelId: string) {
  return 'https://mixer.com/' + encodeURIComponent(channelId);
}

function isNotFoundChannel(err: any) {
  return err.name === 'HTTPError' && err.statusCode === 404 &&
    err.body && err.body.error === 'Not Found' && err.body.message === 'Channel not found.';
}

export default Mixer;