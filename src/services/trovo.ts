import {ServiceInterface, ServiceStream} from "../checker";
import Main from "../main";
import parallel from "../tools/parallel";
import ErrorWithCode from "../tools/errorWithCode";
import * as s from "superstruct";
import fetchRequest, {HTTPError} from "../tools/fetchRequest";
import RateLimit2 from "../tools/rateLimit2";

const debug = require('debug')('app:Trovo');

const rateLimit = new RateLimit2(1200, 60 * 1000);

const limitedFetchRequest = rateLimit.wrap(fetchRequest);
const requestSingleChannelLimit = new RateLimit2(400, 60 * 1000);

const ChannelStruct = s.object({
  is_live: s.boolean(),
  category_id: s.string(),
  category_name: s.string(),
  live_title: s.string(),
  audi_type: s.enums([
    "CHANNEL_AUDIENCE_TYPE_FAMILYFRIENDLY",
    "CHANNEL_AUDIENCE_TYPE_TEEN",
    "CHANNEL_AUDIENCE_TYPE_EIGHTEENPLUS"
  ]),
  language_code: s.string(),
  thumbnail: s.string(),
  current_viewers: s.number(),
  followers: s.number(),
  streamer_info: s.string(),
  profile_pic: s.string(),
  channel_url: s.string(),
  created_at: s.string(),
  subscriber_num: s.number(),
  username: s.string(),
  social_links: s.array(s.object({
    type: s.string(),
    url: s.string(),
  })),
  started_at: s.string(),
  ended_at: s.string(),
});

const UsersStruct = s.object({
  total: s.number(),
  users: s.array(s.object({
    user_id: s.string(),
    username: s.string(),
    nickname: s.string(),
    channel_id: s.string(),
  })),
});

class Trovo implements ServiceInterface {
  id = 'trovo';
  name = 'Trovo';
  batchSize = 100;
  noCachePreview = true;

  constructor(public main: Main) {}

  match(url: string) {
    return [
      /trovo\.live\//i
    ].some(re => re.test(url));
  }

  getStreams(channelIds: string[]) {
    const resultStreams: ServiceStream[] = [];
    const skippedChannelIds: (number | string)[] = [];
    const removedChannelIds: (number | string)[] = [];
    return parallel(10, channelIds, (channelId) => {
      return this.requestChannelById(channelId).then((channel) => {
        if (!channel.is_live) return;

        const previews: string[] = [];
        if (channel.thumbnail) {
          previews.push(channel.thumbnail);
        }

        const id = `${channelId}-${channel.started_at}`;

        resultStreams.push({
          id: id,
          url: channel.channel_url,
          title: channel.live_title,
          game: channel.category_name,
          isRecord: false,
          previews: previews,
          viewers: channel.current_viewers,
          channelId: channelId,
          channelTitle: channel.username,
          channelUrl: channel.channel_url,
        });
      }).catch((err: any) => {
        debug(`getStreams for channel (%s) skip, cause: %o`, channelId, err);
        if (err.code === 'CHANNEL_BY_ID_IS_NOT_FOUND') {
          removedChannelIds.push(channelId);
        } else {
          skippedChannelIds.push(channelId);
        }
      });
    }).then(() => {
      return {streams: resultStreams, skippedChannelIds, removedChannelIds};
    });
  }

  getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    return parallel(10, ids, (channelId) => {
      return requestSingleChannelLimit.run(() => {
        return this.requestChannelById(channelId);
      }).then(() => {
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

  requestChannelById(channelId: string) {
    return limitedFetchRequest('https://open-api.trovo.live/openplatform/channels/id', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-Id': this.main.config.trovoClientId,
      },
      body: JSON.stringify({
        channel_id: channelId,
      }),
      keepAlive: true,
      responseType: 'json',
    }).then(({body}) => {
      s.assert(body, ChannelStruct);
      if (!body.username) {
        throw new ErrorWithCode('Channel username is empty', 'CHANNEL_BY_ID_IS_NOT_FOUND');
      }
      return body;
    });
  }

  requestUserByUsername(username: string) {
    return limitedFetchRequest('https://open-api.trovo.live/openplatform/getusers', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-Id': this.main.config.trovoClientId,
      },
      body: JSON.stringify({
        user: [username],
      }),
      keepAlive: true,
      responseType: 'json',
    }).then(({body}) => {
      s.assert(body, UsersStruct);
      if (!body.users.length) {
        throw new ErrorWithCode('Channel by username is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }
      const user = body.users[0];
      return user;
    }).catch((err: HTTPError) => {
      if (err.name === 'HTTPError' && err.response.statusCode === 400) {
        throw new ErrorWithCode('Get channels by username error', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }
      throw err;
    });
  }

  findChannel(query: string) {
    return this.getChannelNameByUrl(query).then(async (name) => {
      return this.requestUserByUsername(name);
    }).then((user) => {
      let id = user.channel_id;

      const title = user.nickname;
      const url = getChannelUrl(user.username);
      return {id, title, url};
    });
  }

  async getChannelNameByUrl(url: string) {
    let channelName = '';
    [
      /trovo\.live\/([\w\-]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelName = m[1].toLowerCase();
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

function getChannelUrl(userLogin: string) {
  return 'https://trovo.live/' + encodeURIComponent(userLogin);
}

export default Trovo;
