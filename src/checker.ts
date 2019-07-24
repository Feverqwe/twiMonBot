import Main from "./main";
import {everyMinutes} from "./tools/everyTime";
import serviceId from "./tools/serviceId";
import ensureMap from "./tools/ensureMap";
import arrayDifferent from "./tools/arrayDifferent";

const debug = require('debug')('app:Checker');

export interface RawStream {
  id: string|number,
  url: string,
  title: string,
  game: string|null,
  isRecord: boolean,
  previews: string[],
  viewers: number|null,
  channelId: string|number,
  channelTitle: string,
}

interface Stream extends RawStream {
  id: string,
  channelId: string,
  telegramPreviewFileId: string|null,
  offlineFrom: Date|null,
  isOffline: boolean,
  timeoutFrom: Date|null,
  isTimeout: boolean,
  hasChanges: boolean,
}

interface DbStream extends Stream {
  get: (any) => Stream
}

export interface ServiceInterface {
  id: string,
  name: string,
  batchSize: number,
  match(string): boolean,
  getStreams(channelsIds: (string|number)[]): Promise<{streams: RawStream[], skippedChannelIds: (string|number)[], removedChannelIds: (string|number)[]}>,
  getExistsChannelIds(channelsIds: (string|number)[]): Promise<(string|number)[]>,
  findChannel(query: string): Promise<{id: string|number, title: string, url: string}>,
}

interface Channel {
  id: string,
  service: string,
  title: string,
  url: string,
  lastSyncAt: Date,
  syncTimeoutExpiresAt: Date
}

interface DbChannel extends Channel {
  get: (any) => Channel
}

class Checker {
  main: Main;
  constructor(main) {
    this.main = main;
  }

  init() {
    this.startUpdateInterval();
  }

  updateTimer = null;
  startUpdateInterval() {
    this.updateTimer && this.updateTimer();
    this.updateTimer = everyMinutes(this.main.config.emitCheckChannelsEveryMinutes, () => {
      this.check().catch((err) => {
        debug('check error', err);
      });
    });
  }

  check = async () => {
    this.main.services.forEach((service) => {
      if (!this.serviceThread.has(service)) {
        this.serviceThread.set(service, this.runThread(service));
      }
    });
  };

  serviceThread = new Map();

  async runThread(service: ServiceInterface) {
    while (true) {
      const channels: DbChannel[] = await this.main.db.getServiceChannelsForSync(service.id, service.batchSize);
      if (!channels.length) {
        break;
      }

      const channelIdChannel: Map<string, DbChannel> = new Map();
      const channelIds: string[] = [];
      const rawChannelIds: (string|number)[] = [];
      channels.forEach((channel) => {
        channelIdChannel.set(channel.id,  channel);
        channelIds.push(channel.id);
        rawChannelIds.push(serviceId.unwrap(channel.id));
      });

      const syncAt = new Date();
      await this.main.db.setChannelsSyncTimeoutExpiresAt(channelIds).then(() => {
        return service.getStreams(rawChannelIds);
      }).then(({streams: rawStreams, skippedChannelIds: skippedRawChannelIds, removedChannelIds: removedRawChannelIds}) => {
        const streams: Stream[] = [];

        const checkedChannelIds = channelIds.slice(0);
        const onMapRawChannel = (rawId) => {
          const id = serviceId.wrap(service, rawId);
          const pos = checkedChannelIds.indexOf(id);
          if (pos !== -1) {
            checkedChannelIds.splice(pos, 1);
          }
          return id;
        };
        const skippedChannelIds = skippedRawChannelIds.map(onMapRawChannel);
        const removedChannelIds = removedRawChannelIds.map(onMapRawChannel);

        rawStreams.forEach((rawStream) => {
          const stream: Stream = Object.assign({}, rawStream, {
            id: serviceId.wrap(service, rawStream.id),
            channelId: serviceId.wrap(service, rawStream.channelId),
            telegramPreviewFileId: null,
            isOffline: false,
            offlineFrom: null,
            isTimeout: false,
            timeoutFrom: null,
            hasChanges: true,
          });

          if (!checkedChannelIds.includes(stream.channelId)) {
            debug('Stream %s skip, cause: Channel %s is not exists', stream.id, stream.channelId);
            return;
          }

          streams.push(stream);
        });

        return this.main.db.getStreamsByChannelIds(channelIds).then((existsDbStreams: DbStream[]) => {
          const existsStreamIds: string[] = [];
          const existsStreamIdStream: Map<string, Stream> = new Map();
          existsDbStreams.forEach((dbStream) => {
            const stream = dbStream.get({plain: true});
            existsStreamIds.push(stream.id);
            existsStreamIdStream.set(stream.id, stream);
          });

          return {streams, existsStreamIds, existsStreamIdStream, checkedChannelIds, skippedChannelIds, removedChannelIds};
        });
      }).then(({streams, existsStreamIds, existsStreamIdStream, checkedChannelIds, skippedChannelIds, removedChannelIds}) => {
        const streamIds: string[] = [];
        const streamIdStream: Map<string, Stream> = new Map();
        const channelIdsChanges:{[s: string]: {[s: string]: any}} = {};
        const channelIdStreamIds:Map<string, string[]> = new Map();

        checkedChannelIds.forEach((id) => {
          const channel = channelIdChannel.get(id);
          channelIdsChanges[id] = Object.assign({}, channel.get({plain: true}), {
            lastSyncAt: syncAt
          });
        });

        streams.forEach((stream) => {
          const channel = channelIdChannel.get(stream.channelId);
          const channelChanges = channelIdsChanges[channel.id];

          const title = channelChanges.title || channel.title;
          if (title !== stream.channelTitle) {
            channelChanges.title = stream.channelTitle;
          }

          const channelStreamIds = ensureMap(channelIdStreamIds, stream.channelId, []);
          channelStreamIds.push(stream.id);

          streamIds.push(stream.id);
          streamIdStream.set(stream.id, stream);
        });

        const offlineStreamIds = arrayDifferent(existsStreamIds, streamIds);
        const newStreamIds = arrayDifferent(streamIds, existsStreamIds);
        const updatedStreamIds = arrayDifferent(streamIds, newStreamIds);

        const migratedStreamsIds = [];
        const timeoutStreamIds = [];
        const removedStreamIds = [];
        offlineStreamIds.slice(0).forEach((id) => {
          const stream = existsStreamIdStream.get(id);

          if (skippedChannelIds.includes(stream.channelId)) {
            timeoutStreamIds.push(id);
            if (!stream.isTimeout) {
              stream.isTimeout = true;
              stream.timeoutFrom = new Date();
              stream.hasChanges = true;
            }
            const pos = offlineStreamIds.indexOf(id);
            if (pos !== -1) {
              offlineStreamIds.splice(pos, 1);
            }
            return;
          }

          const channelStreamIds = channelIdStreamIds.get(stream.channelId);
          if (channelStreamIds) {
            const channelNewStreams = arrayDifferent(channelStreamIds, updatedStreamIds).map(id => streamIdStream.get(id));
            const similarStream = findSimilarStream(channelNewStreams, stream);
            if (similarStream) {
              migratedStreamsIds.push([stream.id, similarStream.id]);
              const pos = newStreamIds.indexOf(id);
              if (pos !== -1) {
                newStreamIds.splice(pos, 1);
              }
              return;
            }
          }

          if (!stream.isOffline) {
            stream.isOffline = true;
            stream.offlineFrom = new Date();
            stream.hasChanges = true;
          } else {
            const minOfflineDate = new Date();
            minOfflineDate.setMinutes(minOfflineDate.getMinutes() - this.main.config.removeStreamIfOfflineMoreThanMinutes);
            if (stream.offlineFrom.getTime() < minOfflineDate.getTime()) {
              removedStreamIds.push(id);
              const pos = offlineStreamIds.indexOf(id);
              if (pos !== -1) {
                offlineStreamIds.splice(pos, 1);
              }
            }
          }
        });

        const newStreamChannelIds = newStreamIds.map((id) => {
          const stream = streamIdStream.get(id);
          return stream.channelId;
        });

        return this.main.db.getChatIdChannelIdByChannelIds(newStreamChannelIds).then((chatIdChannelIdList) => {
          // todo...
        });
      });
    }

    this.serviceThread.delete(service);
  }
}

function findSimilarStream(streams: Stream[], target: Stream) {
  let result = null;
  streams.some((stream) => {
    if (
        stream.title === target.title &&
        stream.game === target.game &&
        stream.isRecord === target.isRecord
    ) {
      result = stream;
      return true;
    }
  });
  return result;
}

export default Checker;