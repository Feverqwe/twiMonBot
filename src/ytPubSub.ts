import Main from "./main";
import PubSubHubbub, {createServer} from "./vendor/pubsubhubbub";
import {everyMinutes} from "./tools/everyTime";
import parallel from "./tools/parallel";
import serviceId from "./tools/serviceId";
import ErrorWithCode from "./tools/errorWithCode";
import LogFile from "./logFile";
import arrayDifference from "./tools/arrayDifference";
import getInProgress from "./tools/getInProgress";

const debug = require('debug')('app:YtPubSub');
const {XmlDocument} = require("xmldoc");
const qs = require('querystring');
const promiseLimit = require('promise-limit');
const oneLimit = promiseLimit(1);
const throttle = require('lodash.throttle');

class YtPubSub {
  main: Main;
  private hubUrl: string;
  private pubsub: PubSubHubbub;
  private log: LogFile;
  constructor(main: Main) {
    this.main = main;
    this.log = new LogFile('feeds');
    this.hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
  }

  init() {
    this.pubsub = createServer(this.main.config.push);

    return new Promise((resolve, reject) => {
      this.initListener((err) => err ? reject(err) : resolve());
    }).then(() => {
      this.startSyncFeedsInterval();
      this.startUpdateInterval();
      this.startCleanInterval();
    });
  }

  syncFeedsTimer: () => void = null;
  startSyncFeedsInterval() {
    this.syncFeedsTimer && this.syncFeedsTimer();
    this.syncFeedsTimer = everyMinutes(this.main.config.emitFeedSyncEveryMinutes, () => {
      this.syncFeeds().catch((err: any) => {
        debug('syncFeeds error', err);
      });
    });
  }

  updateTimer: () => void = null;
  startUpdateInterval() {
    this.updateTimer && this.updateTimer();
    this.updateTimer = everyMinutes(this.main.config.emitUpdateChannelPubSubSubscribeEveryMinutes, () => {
      this.updateSubscribes().catch((err: any) => {
        debug('updateSubscribes error', err);
      });
    });
  }

  cleanTimer: () => void = null;
  startCleanInterval() {
    this.cleanTimer && this.cleanTimer();
    this.cleanTimer = everyMinutes(this.main.config.emitCleanPubSubFeedEveryHours * 60, () => {
      this.clean().catch((err: any) => {
        debug('clean error', err);
      });
    });
  }

  updateSubscribes() {
    return oneLimit(async () => {
      while (true) {
        const channelIds = await this.main.db.getChannelIdsWithExpiresSubscription(50);
        if (!channelIds.length) {
          break;
        }

        await this.main.db.setChannelsSubscriptionTimeoutExpiresAt(channelIds).then(() => {
          const expiresAt = new Date();
          expiresAt.setSeconds(expiresAt.getSeconds() + this.main.config.push.leaseSeconds);

          const subscribedChannelIds: string[] = [];
          return parallel(10, channelIds, (id) => {
            const rawId = serviceId.unwrap(id) as string;
            return this.subscribe(rawId).then(() => {
              subscribedChannelIds.push(id);
            }, (err: any) => {
              debug('subscribe channel %s skip, cause: %o', id, err);
            });
          }).then(() => {
            return this.main.db.setChannelsSubscriptionExpiresAt(subscribedChannelIds, expiresAt).then(([affectedRows]) => {
              return {affectedRows};
            });
          });
        });
      }
    });
  }

  async clean() {
    return oneLimit(() => {
      return this.main.db.cleanYtPubSub().then((count) => {
        return {removedVideoIds: count};
      });
    });
  }

  subscribe(channelId: string) {
    const topicUrl = getTopicUrl(channelId);

    return new Promise((resolve, reject) => {
      // @ts-ignore
      this.pubsub.subscribe(topicUrl, this.hubUrl, (err: any, topic: string) => {
        err ? reject(err) : resolve(topic);
      });
    });
  }

  unsubscribe(channelId: string) {
    const topicUrl = getTopicUrl(channelId);

    return new Promise((resolve, reject) => {
      // @ts-ignore
      this.pubsub.unsubscribe(topicUrl, this.hubUrl, (err: any, topic: string) => {
        err ? reject(err) : resolve(topic);
      });
    });
  }

  initListener(callback: (err?: any) => void) {
    this.pubsub.on("listen", () => {
      callback();
    });

    this.pubsub.on('error', (err) => {
      callback(err);
    });

    this.pubsub.on('denied', (err) => {
      debug('Denied %o', err);
    });

    this.pubsub.on('feed', (data: PubSubFeed) => {
      this.handleFeed(data);
    });

    this.pubsub.listen(this.main.config.push.port, this.main.config.push.host);
  }

  feeds: Feed[] = [];
  emitFeedsChanges = () => {
    const minPubDate = new Date();
    minPubDate.setDate(minPubDate.getDate() - this.main.config.cleanPubSubFeedIfPushOlderThanDays);

    return oneLimit(async () => {
      while (this.feeds.length) {
        let feeds = this.feeds.splice(0);

        feeds = feeds.filter((feed) => {
          if (feed.publishedAt.getTime() > minPubDate.getTime()) {
            return true;
          }
        });

        await this.main.db.putFeeds(feeds);
      }
    });
  };
  emitFeedsChangesThrottled = throttle(this.emitFeedsChanges, 1000, {
    leading: false
  });

  handleFeed(data: PubSubFeed) {
    try {
      this.log.write('data', JSON.stringify({
        feed: data.feed.toString()
      }));
      const feed = parseData(data.feed.toString());
      this.feeds.push(feed);
      this.emitFeedsChangesThrottled();
    } catch (err) {
      if (err.code === 'ENTRY_IS_DELETED') {
        // pass
      } else {
        debug('parseData skip, cause: %o', err);
      }
    }
  }

  syncFeedsInProgress = getInProgress();
  syncFeeds() {
    return this.syncFeedsInProgress(async () => {
      while (true) {
        const feeds = await this.main.db.getChangedFeedsWithoutOther(50);
        if (!feeds.length) break;

        const feedIdFeed = new Map();
        feeds.forEach((feed) => {
          feedIdFeed.set(feed.id, feed);
        });
        const feedIds = Array.from(feedIdFeed.keys());

        await this.main.db.setFeedsSyncTimeoutExpiresAt(feedIds);

        const {streamIds, onlineIds} = await this.main.youtube.getStreamsByIds(feedIds);
        const otherIds: string[] = arrayDifference(feedIds, streamIds);
        const offlineIds: string[] = arrayDifference(streamIds, onlineIds);

        return this.main.db.updateFeeds(onlineIds, offlineIds, otherIds);
      }
    });
  }
}

interface PubSubFeed {
  topic: string|undefined,
  hub: string|undefined,
  callback: string,
  feed: Buffer
  headers: Headers
}

interface Feed {
  id: string,
  channelId: string,
  publishedAt: Date,
  hasChanges: boolean,
}

function parseData(xml: string): Feed {
  const document = new XmlDocument(xml);

  const entry = getChildNode(document, 'entry');
  if (!entry) {
    const isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
    if (isDeletedEntry) {
      throw new ErrorWithCode('Entry deleted!', 'ENTRY_IS_DELETED');
    }
  }

  try {
    if (!entry) {
      throw new ErrorWithCode('Entry is not found!', 'ENTRY_IS_NOT_FOUND');
    }

    const data: {[s: string]: string} = {};
    const success = ['yt:videoId', 'yt:channelId', 'published'].every((field) => {
      const node = getChildNode(entry, field);
      if (node) {
        data[field] = node.val;
        return true;
      }
    });
    if (!success) {
      throw new ErrorWithCode('Some fields is not found', 'SOME_FIELDS_IS_NOT_FOUND');
    }

    return {
      id: data['yt:videoId'],
      channelId: data['yt:channelId'],
      publishedAt: new Date(data.published),
      hasChanges: true
    };
  } catch (err) {
    debug('parseData error, cause: Some data is not found %j', document.toString({compressed: true}));
    throw err;
  }
}

function getTopicUrl(channelId: string) {
  return 'https://www.youtube.com/xml/feeds/videos.xml' + '?' + qs.stringify({
    channel_id: channelId
  });
}

interface XmlElement {
  name: string,
  val: string,
  children?: XmlElement[]
}

function getChildNode(root: XmlElement, name: string): XmlElement {
  let el = null;
  if (root.children) {
    for (let i = 0, node; node = root.children[i]; i++) {
      if (node.name === name) {
        return node;
      }
    }
  }
  return el;
}

export default YtPubSub;