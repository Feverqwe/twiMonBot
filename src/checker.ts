import Main from "./main";
import {everyMinutes} from "./tools/everyTime";
import serviceId from "./tools/serviceId";
import ensureMap from "./tools/ensureMap";
import arrayDifferent from "./tools/arrayDifferent";
import {Channel, IChannel, Stream} from "./db";
import LogFile from "./logFile";

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

export interface ServiceInterface {
  id: string,
  name: string,
  batchSize: number,
  match(string): boolean,
  getStreams(channelsIds: (string|number)[]): Promise<{streams: RawStream[], skippedChannelIds: (string|number)[], removedChannelIds: (string|number)[]}>,
  getExistsChannelIds(channelsIds: (string|number)[]): Promise<(string|number)[]>,
  findChannel(query: string): Promise<{id: string|number, title: string, url: string}>,
}

class Checker {
  main: Main;
  log: LogFile;
  constructor(main) {
    this.main = main;
    this.log = new LogFile('checker');
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
      const channels: IChannel[] = await this.main.db.getServiceChannelsForSync(service.id, service.batchSize);
      if (!channels.length) {
        break;
      }

      const channelIdChannel: Map<string, Channel> = new Map();
      const channelIds: string[] = [];
      const rawChannelIds: (string|number)[] = [];
      channels.forEach((channel) => {
        channelIdChannel.set(channel.id, channel.get({plain: true}) as Channel);
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

        return this.main.db.getStreamsByChannelIds(channelIds).then((existsDbStreams) => {
          const existsStreamIds: string[] = [];
          const existsStreamIdStream: Map<string, Stream> = new Map();
          existsDbStreams.forEach((dbStream) => {
            const stream = dbStream.get({plain: true}) as Stream;
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
          channelIdsChanges[id] = Object.assign({}, channel, {
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

        const migratedStreamFromIdToId = new Map();
        const migratedStreamToIdFromId = new Map();
        const migratedStreamsIds = [];
        const timeoutStreamIds = [];
        const removedStreamIds = [];
        offlineStreamIds.slice(0).forEach((id) => {
          const stream = existsStreamIdStream.get(id);

          if (skippedChannelIds.includes(stream.channelId)) {
            const pos = offlineStreamIds.indexOf(id);
            if (pos !== -1) {
              offlineStreamIds.splice(pos, 1);

              timeoutStreamIds.push(id);
              if (!stream.isTimeout) {
                stream.isTimeout = true;
                stream.timeoutFrom = new Date();
                stream.hasChanges = true;
              }
            }
            return;
          }

          const channelStreamIds = channelIdStreamIds.get(stream.channelId);
          if (channelStreamIds) {
            const channelNewStreams = arrayDifferent(channelStreamIds, updatedStreamIds).map(id => streamIdStream.get(id));
            const similarStream = findSimilarStream(channelNewStreams, stream);
            if (similarStream) {
              const oPos = offlineStreamIds.indexOf(id);
              const nPos = newStreamIds.indexOf(similarStream.id);
              if (oPos !== -1 && nPos !== -1) {
                offlineStreamIds.splice(oPos, 1);
                newStreamIds.splice(nPos, 1);

                migratedStreamFromIdToId.set(stream.id, similarStream.id);
                migratedStreamToIdFromId.set(similarStream.id, stream.id);
                migratedStreamsIds.push(similarStream.id);
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
              const pos = offlineStreamIds.indexOf(id);
              if (pos !== -1) {
                offlineStreamIds.splice(pos, 1);

                removedStreamIds.push(id);
              }
            }
          }
        });

        const channelIdNewStreamIds = new Map();
        newStreamIds.forEach((id) => {
          const stream = streamIdStream.get(id);
          const channelStreamIds = ensureMap(channelIdNewStreamIds, stream.channelId, []);
          channelStreamIds.push(stream.id);
        });
        const newStreamChannelIds = Array.from(channelIdNewStreamIds.keys());

        return this.main.db.getChatIdChannelIdByChannelIds(newStreamChannelIds).then((chatIdChannelIdList) => {
          const channelIdChats: Map<string, {chatId: string, isMutedRecords: boolean}[]> = new Map();
          chatIdChannelIdList.forEach((chatIdChannelId) => {
            const chats = ensureMap(channelIdChats, chatIdChannelId.channelId, []);
            if (!chatIdChannelId.chat.channelId || !chatIdChannelId.chat.isMuted) {
              chats.push({chatId: chatIdChannelId.chat.id, isMutedRecords: chatIdChannelId.chat.isMutedRecords});
            }
            if (chatIdChannelId.chat.channelId) {
              chats.push({chatId: chatIdChannelId.chat.channelId, isMutedRecords: chatIdChannelId.chat.isMutedRecords});
            }
          });

          const chatIdStreamIdChanges = [];
          for (const [channelId, chats] of channelIdChats.entries()) {
            const streamIds = channelIdNewStreamIds.get(channelId);
            if (streamIds) {
              streamIds.forEach((streamId) => {
                const stream = streamIdStream.get(streamId);
                chats.forEach(({chatId, isMutedRecords}) => {
                  if (!stream.isRecord || !isMutedRecords) {
                    chatIdStreamIdChanges.push({chatId, streamId});
                  }
                });
              });
            }
          }

          const channelsChanges = Object.values(channelIdsChanges);

          const migratedStreamsIdCouple = Array.from(migratedStreamFromIdToId.entries());
          const syncStreams: Stream[] = [].concat(newStreamIds, migratedStreamsIds, updatedStreamIds, offlineStreamIds, timeoutStreamIds).map(id => streamIdStream.get(id));

          return this.main.db.putStreams(
            channelsChanges,
            removedChannelIds,
            migratedStreamsIdCouple,
            syncStreams,
            removedStreamIds,
            chatIdStreamIdChanges,
          ).then(() => {
            streams.forEach((stream) => {
              if (newStreamIds.includes(stream.id)) {
                this.log.write(`[new] ${stream.channelId} ${stream.id}`);
              } else
              if (migratedStreamsIds.includes(stream.id)) {
                const fromId = migratedStreamToIdFromId.get(stream.id);
                this.log.write(`[${fromId} > ${stream.id}] ${stream.channelId} ${stream.id}`);
              } else
              if (updatedStreamIds.includes(stream.id)) {
                // pass
              } else {
                this.log.write(`[?] ${stream.channelId} ${stream.id}`);
              }
            });
            timeoutStreamIds.forEach((id) => {
              const stream = existsStreamIdStream.get(id);
              this.log.write(`[timeout] ${stream.channelId} ${stream.id}`);
            });
            offlineStreamIds.forEach((id) => {
              const stream = existsStreamIdStream.get(id);
              this.log.write(`[offline] ${stream.channelId} ${stream.id}`);
            });
            removedStreamIds.forEach((id) => {
              this.log.write(`[removed] ${id}`);
            });

            // todo: fix me
            // this.main.sender.checkThrottled();

            return {
              streams: streams.length,
              new: newStreamIds.length,
              migrated: migratedStreamsIds.length,
              timeout: timeoutStreamIds.length,
              offline: offlineStreamIds.length,
              removed: removedStreamIds.length,
            };
          });
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