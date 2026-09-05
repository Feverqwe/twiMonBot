import ErrorWithCode from '../shared/tools/errorWithCode';
import arrayByPart from '../shared/tools/arrayByPart';
import serviceId from '../tools/serviceId';
import type Main from '../main';
import parallel from '../shared/tools/parallel';
import type {ServiceChannel, ServiceInterface} from '../checker';
import Sequelize, {Op} from 'sequelize';
import arrayDifference from '../shared/tools/arrayDifference';
import {appConfig} from '../appConfig';
import {getDebug} from '../shared/tools/getDebug';
import isDatabaseDeadlock from '../shared/tools/isDatabaseDeadlock';
import parseAggregateCount from '../shared/tools/parseAggregateCount';
import createMigrator from '../shared/migrator';
import {
  ChannelModel,
  ChatIdChannelIdModel,
  ChatIdStreamIdModel,
  ChatModel,
  MessageModel,
  StreamModel,
  YtPubSubChannelModel,
  YtPubSubFeedModel,
  initModels,
} from './models';
import type {
  Channel,
  Message,
  NewChatIdStreamId,
  Stream,
  YtPubSubChannel,
  YtPubSubFeed,
} from './models';

const debug = getDebug('app:db');

class Db {
  sequelize: Sequelize.Sequelize;
  constructor(private main: Main) {
    this.sequelize = new Sequelize.Sequelize(
      appConfig.db.database,
      appConfig.db.user,
      appConfig.db.password,
      {
        host: appConfig.db.host,
        port: appConfig.db.port,
        dialect: 'mariadb',
        omitNull: true,
        logging: false,
        /*dialectOptions: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_general_ci'
      },*/
        define: {
          charset: 'utf8mb4',
        },
        pool: {
          max: 30,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      },
    );

    initModels(this.sequelize);
  }

  /**
   * @returns {Promise}
   */
  async init() {
    await this.sequelize.authenticate();
    await createMigrator(this.sequelize).up();
    await this.removeChannelByIds(appConfig.channelBlackList);
  }

  async close() {
    await this.sequelize.close();
  }

  async ensureChat(id: string) {
    const [model, isCreated] = await ChatModel.findOrCreate({
      where: {id},
      include: [{model: ChatModel, as: 'channel'}],
    });
    const {channel} = model;
    if (channel === undefined) {
      throw new Error('Chat channel association was not loaded');
    }
    return Object.assign(model, {channel});
  }

  async createChatChannel(chatId: string, channelId: string) {
    return this.sequelize.transaction(async (transaction) => {
      await ChatModel.create(
        {
          id: channelId,
          parentChatId: chatId,
        },
        {
          transaction,
        },
      );
      await ChatModel.upsert(
        {
          id: chatId,
          channelId: channelId,
        },
        {
          transaction,
        },
      );
    });
  }

  async changeChatId(id: string, newId: string) {
    return ChatModel.update(
      {id: newId},
      {
        where: {id},
      },
    );
  }

  async getChatIds(offset: number, limit: number) {
    const chats: Pick<ChatModel, 'id'>[] = await ChatModel.findAll({
      offset,
      limit,
      attributes: ['id'],
    });
    return chats.map((chat) => chat.id);
  }

  async getChatById(id: string) {
    const chat = await ChatModel.findByPk(id);
    if (!chat) {
      throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
    }
    return chat;
  }

  async getChatsByIds(ids: string[]) {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  async setChatSendTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.chatSendTimeoutAfterErrorMinutes * 60);
    return ChatModel.update(
      {sendTimeoutExpiresAt: date},
      {
        where: {id: ids},
      },
    );
  }

  async deleteChatById(id: string) {
    return ChatModel.destroy({
      where: {id},
    });
  }

  async deleteChatsByIds(ids: string[]) {
    return ChatModel.destroy({
      where: {id: ids},
    });
  }

  async cleanChats() {
    return ChatModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null,
      },
    });
  }

  async ensureChannel(service: ServiceInterface, rawChannel: ServiceChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    if (appConfig.channelBlackList.includes(id)) {
      throw new ErrorWithCode('Channel in black list', 'CHANNEL_IN_BLACK_LIST');
    }

    const [channel, isCreated] = await ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id}),
    });
    return channel;
  }

  async hasChannelByServiceRawId(service: ServiceInterface, rawChannelId: string | number) {
    const id = serviceId.wrap(service, rawChannelId);

    const channel: Pick<ChannelModel, 'id'> | null = await ChannelModel.findOne({
      where: {id},
      attributes: ['id'],
    });
    return channel !== null;
  }

  async changeChannelId(id: string, newId: string) {
    return ChannelModel.update(
      {id: newId},
      {
        where: {id},
      },
    );
  }

  async getChatIdChannelIdChatIdCount() {
    const count = await ChatIdChannelIdModel.count({
      col: 'chatId',
      distinct: true,
    });
    return count;
  }

  async getChatIdChannelIdChannelIdCount() {
    const count = await ChatIdChannelIdModel.count({
      col: 'channelId',
      distinct: true,
    });
    return count;
  }

  async getChatIdChannelIdTop10ByServiceId(serviceId: string) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const results = await ChatIdChannelIdModel.findAll({
      include: [
        {
          model: ChannelModel,
          required: true,
          attributes: ['title', 'service'],
          where: [
            {
              service: serviceId,
              lastStreamAt: {[Op.gt]: monthAgo},
            },
          ],
        },
      ],
      attributes: ['channelId', [Sequelize.fn('COUNT', Sequelize.col('chatId')), 'chatCount']],
      group: 'channelId',
      order: [['chatCount', 'DESC']],
      limit: 10,
    });

    return results.map((result) => {
      const {channel, channelId, chatCount} = result.get({plain: true}) as unknown as {
        channel?: {title?: unknown; service?: unknown};
        channelId?: unknown;
        chatCount?: unknown;
      };
      if (
        !channel ||
        typeof channelId !== 'string' ||
        typeof channel.title !== 'string' ||
        typeof channel.service !== 'string'
      ) {
        throw new Error('Top channel query did not return all selected fields');
      }
      return {
        channelId,
        chatCount: parseAggregateCount(chatCount, 'Top channel query'),
        title: channel.title,
        service: channel.service,
      };
    });
  }

  async getServiceIdChannelCount(serviceIds: string[]) {
    const results = await ChannelModel.findAll({
      attributes: ['service', [Sequelize.fn('COUNT', Sequelize.col('id')), 'channelCount']],
      group: 'service',
      where: {
        service: serviceIds,
      },
    });
    return results.map((result) => {
      const {service, channelCount} = result.get({plain: true}) as unknown as {
        service?: unknown;
        channelCount?: unknown;
      };
      if (typeof service !== 'string') {
        throw new Error('Service channel count query did not return the service');
      }
      return {
        service,
        channelCount: parseAggregateCount(channelCount, 'Service channel count query'),
      };
    });
  }

  async getChannelsByChatId(chatId: string) {
    const chatIdChannelIdList = await ChatIdChannelIdModel.findAll({
      include: [{model: ChannelModel, required: true}],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    });
    return chatIdChannelIdList.map((chatIdChannelId) => {
      const {channel} = chatIdChannelId;
      if (!channel) {
        throw new Error('Channel association was not loaded');
      }
      return channel;
    });
  }

  async getChannelsByIds(ids: string[]) {
    return ChannelModel.findAll({
      where: {id: ids},
    });
  }

  async getChannelById(id: string) {
    const channel = await ChannelModel.findByPk(id);
    if (!channel) {
      throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
    }
    return channel;
  }

  async getChannelCountByChatId(chatId: string) {
    return ChatIdChannelIdModel.count({
      where: {chatId},
    });
  }

  async putChatIdChannelId(chatId: string, channelId: string) {
    const [model, isCreated] = await ChatIdChannelIdModel.upsert({chatId, channelId});
    return Boolean(isCreated);
  }

  async deleteChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId},
    });
  }

  async getServiceChannelsForSync(serviceId: string, limit: number) {
    const date = new Date();
    date.setSeconds(date.getSeconds() - appConfig.checkChannelIfLastSyncLessThenMinutes * 60);
    return ChannelModel.findAll({
      where: {
        service: serviceId,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      order: Sequelize.literal(`lastStreamAt IS NULL, lastSyncAt`),
      limit: limit,
    });
  }

  async getChannelIdsByServiceId(service: string, offset: number, limit: number) {
    const channels: Pick<ChannelModel, 'id'>[] = await ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset,
      limit,
    });
    return channels.map((channel) => channel.id);
  }

  async setChannelsSyncTimeoutExpiresAt(ids: string[]) {
    const aliveTimeout = new Date();
    aliveTimeout.setSeconds(aliveTimeout.getSeconds() + appConfig.channelSyncTimeoutMinutes * 60);

    const deadTimeout = new Date();
    deadTimeout.setSeconds(deadTimeout.getSeconds() + appConfig.deadChannelSyncTimeoutMinutes * 60);

    const channelIsDeadFromDate = new Date();
    channelIsDeadFromDate.setMonth(channelIsDeadFromDate.getMonth() - 3);

    return Promise.all([
      ChannelModel.update(
        {
          syncTimeoutExpiresAt: aliveTimeout,
        },
        {
          where: {
            id: ids,
            [Op.or]: [
              {lastStreamAt: {[Op.gt]: channelIsDeadFromDate}},
              {
                lastStreamAt: null,
                createdAt: {[Op.gt]: channelIsDeadFromDate},
              },
            ],
          },
        },
      ),
      ChannelModel.update(
        {
          syncTimeoutExpiresAt: deadTimeout,
        },
        {
          where: {
            id: ids,
            [Op.or]: [
              {lastStreamAt: {[Op.lte]: channelIsDeadFromDate}},
              {
                lastStreamAt: null,
                createdAt: {[Op.lte]: channelIsDeadFromDate},
              },
            ],
          },
        },
      ),
    ]);
  }

  async removeChannelByIds(ids: string[]) {
    if (!ids.length) return;
    return ChannelModel.destroy({where: {id: ids}});
  }

  async cleanChannels() {
    return ChannelModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)},
      },
    });
  }

  async getChatIdChannelIdByChannelIds(channelIds: string[]) {
    const results = await ChatIdChannelIdModel.findAll({
      where: {channelId: channelIds},
      include: [
        {
          model: ChatModel,
          attributes: ['id', 'channelId', 'isMuted', 'isMutedRecords'],
          required: true,
        },
      ],
    });
    return results.map((result) => {
      const {chat} = result;
      if (!chat) {
        throw new Error('Chat association was not loaded');
      }
      return Object.assign(result, {chat});
    });
  }

  async putStreams(
    channelsChanges: Channel[],
    removedChannelIds: string[],
    migratedStreamsIdCouple: [string, string][],
    syncStreams: Stream[],
    changedStreamIds: string[],
    removedStreamIds: string[],
    chatIdStreamIdChanges: NewChatIdStreamId[],
  ) {
    let retry = 3;

    const doTry = (): Promise<void> => {
      return this.sequelize
        .transaction(async (transaction) => {
          await Promise.all([
            bulk(channelsChanges, (channelsChanges) => {
              return ChannelModel.bulkCreate(channelsChanges, {
                updateOnDuplicate: ['lastStreamAt', 'lastSyncAt', 'title', 'url'],
                transaction,
              });
            }),
            parallel(10, migratedStreamsIdCouple, ([fromId, id]) => {
              return StreamModel.update(
                {id},
                {
                  where: {id: fromId},
                  transaction,
                },
              );
            }),
          ]);

          await bulk(syncStreams, (syncStreams) => {
            return StreamModel.bulkCreate(syncStreams, {
              updateOnDuplicate: [
                'url',
                'title',
                'game',
                'isRecord',
                'previews',
                'viewers',
                'channelId',
                'telegramPreviewFileId',
                'isOffline',
                'offlineFrom',
                'isTimeout',
                'timeoutFrom',
                'updatedAt',
              ],
              transaction,
            });
          });

          await Promise.all([
            bulk(chatIdStreamIdChanges, (chatIdStreamIdChanges) => {
              return ChatIdStreamIdModel.bulkCreate(chatIdStreamIdChanges, {
                transaction,
              });
            }),
            bulk(changedStreamIds, (changedStreamIds) => {
              return MessageModel.update(
                {hasChanges: true},
                {
                  where: {streamId: changedStreamIds},
                  transaction,
                },
              );
            }),
          ]);

          await Promise.all([
            bulk(removedStreamIds, (removedStreamIds) => {
              return StreamModel.destroy({
                where: {id: removedStreamIds},
                transaction,
              });
            }),
            bulk(removedChannelIds, (removedChannelIds) => {
              return ChannelModel.destroy({
                where: {id: removedChannelIds},
                transaction,
              });
            }),
          ]);
        })
        .catch((err) => {
          if (isDatabaseDeadlock(err) && --retry > 0) {
            const delay = 250 * 2 ** (2 - retry) + Math.random() * 100;
            return new Promise((resolve) => setTimeout(resolve, delay)).then(() => doTry());
          }
          throw err;
        });
    };

    return doTry();
  }

  async getStreamsWithChannelByChannelIds(channelIds: string[]) {
    const results = await StreamModel.findAll({
      where: {channelId: channelIds},
      include: [{model: ChannelModel, required: true}],
      order: ['createdAt'],
    });
    return results.map((stream) => {
      const {channel} = stream;
      if (!channel) {
        throw new Error('Stream channel association was not loaded');
      }
      return Object.assign(stream, {channel});
    });
  }

  async getStreamsByChannelIds(channelIds: string[]) {
    return StreamModel.findAll({
      where: {channelId: channelIds},
    });
  }

  async getOnlineStreamCount() {
    return StreamModel.count({
      where: {
        isOffline: false,
        isRecord: false,
      },
    });
  }

  async getDistinctChatIdStreamIdChatIds() {
    const now = new Date();
    const chats = await ChatModel.findAll({
      include: [
        {
          model: ChatIdStreamIdModel,
          required: true,
          attributes: [],
        },
      ],
      where: {
        sendTimeoutExpiresAt: {[Op.lt]: now},
      },
      attributes: ['id'],
    });
    return chats.map(({id}) => id);
  }

  async getStreamIdsByChatId(chatId: string, limit = 10) {
    const results: Pick<ChatIdStreamIdModel, 'streamId'>[] = await ChatIdStreamIdModel.findAll({
      where: {chatId},
      attributes: ['streamId'],
      order: ['createdAt'],
      limit: limit,
    });
    return results.map((chatIdStreamId) => chatIdStreamId.streamId);
  }

  async getStreamWithChannelById(id: string) {
    const stream = await StreamModel.findOne({
      where: {id},
      include: [{model: ChannelModel, required: true}],
    });
    if (!stream) {
      throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
    }
    const {channel} = stream;
    if (!channel) {
      throw new Error('Stream channel association was not loaded');
    }
    return Object.assign(stream, {channel});
  }

  async getStreamById(id: string) {
    const stream = await StreamModel.findOne({
      where: {id},
      include: [{model: ChannelModel, required: true}],
    });
    if (!stream) {
      throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
    }
    const {channel} = stream;
    if (!channel) {
      throw new Error('Stream channel association was not loaded');
    }
    return Object.assign(stream, {channel});
  }

  async deleteChatIdStreamId(chatId: string, streamId: string) {
    return ChatIdStreamIdModel.destroy({
      where: {chatId, streamId},
    });
  }

  async putMessage(message: Message) {
    return MessageModel.create(message);
  }

  async getDistinctMessagesChatIds() {
    const deletedBeforeDate = getDeletedBeforeDate();
    const now = new Date();
    const chats = await ChatModel.findAll({
      include: [
        {
          model: MessageModel,
          required: true,
          attributes: [],
          where: {
            [Op.or]: [
              {hasChanges: true, streamId: {[Op.not]: null}},
              {streamId: null, createdAt: {[Op.lt]: deletedBeforeDate}},
            ],
          },
        },
      ],
      where: {
        sendTimeoutExpiresAt: {[Op.lt]: now},
      },
      attributes: ['id'],
    });
    return chats.map(({id}) => id);
  }

  async getMessagesByChatId(chatId: string, limit = 10) {
    const messages = await MessageModel.findAll({
      where: {
        chatId,
        hasChanges: true,
        streamId: {[Op.not]: null},
      },
      order: ['createdAt'],
      limit: limit,
    });
    return messages.map((message) => {
      const {streamId} = message;
      if (streamId === null) {
        throw new Error('Message stream ID is unexpectedly null');
      }
      return Object.assign(message, {streamId});
    });
  }

  async getMessagesForDeleteByChatId(chatId: string, limit = 1) {
    const deletedBeforeDate = getDeletedBeforeDate();
    return MessageModel.findAll({
      where: {
        chatId,
        streamId: null,
        createdAt: {[Op.lt]: deletedBeforeDate},
      },
      order: ['createdAt'],
      limit: limit,
    });
  }

  async deleteMessageById(_id: number) {
    return MessageModel.destroy({
      where: {_id},
    });
  }

  async getExistsYtPubSubChannelIds(channelIds: string[]) {
    const results: Pick<YtPubSubChannelModel, 'id'>[] = await YtPubSubChannelModel.findAll({
      where: {
        id: channelIds,
      },
      attributes: ['id'],
    });
    return results.map((item) => item.id);
  }

  async getNotExistsYtPubSubChannelIds(channelIds: string[]) {
    const existsChannelIds = await this.getExistsYtPubSubChannelIds(channelIds);
    return arrayDifference(channelIds, existsChannelIds);
  }

  async ensureYtPubSubChannels(channels: YtPubSubChannel[]) {
    return YtPubSubChannelModel.bulkCreate(channels, {
      updateOnDuplicate: ['id'],
    });
  }

  async getYtPubSubChannelIdsForSync(channelIds: string[]) {
    const date = new Date();
    date.setMinutes(date.getMinutes() - appConfig.checkPubSubChannelIfLastSyncLessThenMinutes);
    const results: Pick<YtPubSubChannelModel, 'id'>[] = await YtPubSubChannelModel.findAll({
      where: {
        id: channelIds,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      order: ['lastSyncAt'],
      attributes: ['id'],
    });
    return results.map(({id}) => id);
  }

  async getYtPubSubChannelsByIds(ids: string[]) {
    return YtPubSubChannelModel.findAll({
      where: {id: ids},
    });
  }

  async setYtPubSubChannelsSyncTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.channelSyncTimeoutMinutes * 60);
    return YtPubSubChannelModel.update(
      {
        syncTimeoutExpiresAt: date,
      },
      {
        where: {id: ids},
      },
    );
  }

  async getYtPubSubChannelIdsWithExpiresSubscription(limit = 50) {
    const date = new Date();
    date.setMinutes(
      date.getMinutes() + appConfig.updateChannelPubSubSubscribeIfExpiresLessThenMinutes,
    );
    const results: Pick<YtPubSubChannelModel, 'id'>[] = await YtPubSubChannelModel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()},
      },
      limit: limit,
      attributes: ['id'],
    });
    return results.map((item) => item.id);
  }

  async setYtPubSubChannelsSubscriptionTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.channelPubSubSubscribeTimeoutMinutes * 60);
    return YtPubSubChannelModel.update(
      {subscriptionTimeoutExpiresAt: date},
      {
        where: {id: ids},
      },
    );
  }

  async setYtPubSubChannelsSubscriptionExpiresAt(ids: string[], expiresAt: Date) {
    return YtPubSubChannelModel.update(
      {subscriptionExpiresAt: expiresAt},
      {
        where: {id: ids},
      },
    );
  }

  async setYtPubSubChannelsLastSyncAt(ids: string[], syncAt: Date) {
    if (!ids.length) return;
    return YtPubSubChannelModel.update(
      {lastSyncAt: syncAt},
      {
        where: {id: ids},
      },
    );
  }

  async setYtPubSubChannelsUpcomingChecked(ids: string[]) {
    if (!ids.length) return;
    return YtPubSubChannelModel.update(
      {isUpcomingChecked: true},
      {
        where: {id: ids},
      },
    );
  }

  async getFeedIdsForSync(channelIds: string[]) {
    const minEndTime = new Date();
    minEndTime.setHours(minEndTime.getHours() - 1);
    const results: Pick<YtPubSubFeedModel, 'id'>[] = await YtPubSubFeedModel.findAll({
      where: {
        channelId: channelIds,
        [Op.or]: [
          {
            isStream: null,
          },
          {
            isStream: true,
            [Op.or]: [{actualEndAt: null}, {actualEndAt: {[Op.gt]: minEndTime}}],
          },
        ],
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
      },
      attributes: ['id'],
    });
    return results.map(({id}) => id);
  }

  async getFeedsByIds(ids: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {id: ids},
    });
  }

  async getExistsFeedIds(ids: string[]) {
    const results: Pick<YtPubSubFeedModel, 'id'>[] = await YtPubSubFeedModel.findAll({
      where: {id: ids},
      attributes: ['id'],
    });
    return results.map((result) => result.id);
  }

  async getExistsFeeds(ids: string[]) {
    const results: Pick<YtPubSubFeedModel, 'id' | 'isStream'>[] = await YtPubSubFeedModel.findAll({
      where: {id: ids},
      attributes: ['id', 'isStream'],
    });
    return results;
  }

  async getStreamFeedsByChannelIds(channelIds: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {
        channelId: channelIds,
        isStream: true,
        actualStartAt: {[Op.not]: null},
        actualEndAt: null,
      },
    });
  }

  async setFeedsSyncTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.feedSyncTimeoutMinutes * 60);
    return YtPubSubFeedModel.update(
      {
        syncTimeoutExpiresAt: date,
      },
      {
        where: {id: ids},
      },
    );
  }

  async putFeeds(feeds: YtPubSubFeed[]) {
    return bulk(feeds, (feeds) => {
      return YtPubSubFeedModel.bulkCreate(feeds, {
        updateOnDuplicate: ['title', 'channelTitle', 'isStream'],
      });
    });
  }

  async updateFeeds(feeds: YtPubSubFeed[]) {
    return bulk(feeds, (feeds) => {
      return YtPubSubFeedModel.bulkCreate(feeds, {
        updateOnDuplicate: [
          'isStream',
          'scheduledStartAt',
          'actualStartAt',
          'actualEndAt',
          'viewers',
        ],
      });
    });
  }

  async cleanYtPubSub() {
    const minCreatedAtDate = new Date();
    minCreatedAtDate.setDate(minCreatedAtDate.getDate() - 1);
    const minStreamEndAtDate = new Date();
    minStreamEndAtDate.setDate(minStreamEndAtDate.getDate() - 1);
    const minStreamScheduledStartAtDate = new Date();
    minStreamScheduledStartAtDate.setDate(minStreamScheduledStartAtDate.getDate() - 1);
    const minStreamCreatedAtDate = new Date();
    minStreamCreatedAtDate.setDate(minStreamCreatedAtDate.getDate() - 7);
    return YtPubSubFeedModel.destroy({
      where: {
        [Op.or]: [
          {
            isStream: true,
            [Op.or]: [
              {
                actualEndAt: {[Op.lt]: minStreamEndAtDate},
              },
              {
                actualStartAt: null,
                actualEndAt: null,
                [Op.or]: [
                  {
                    scheduledStartAt: {[Op.lt]: minStreamScheduledStartAtDate},
                  },
                  {
                    scheduledStartAt: null,
                    createdAt: {[Op.lt]: minStreamCreatedAtDate},
                  },
                ],
              },
            ],
          },
          {
            isStream: false,
            createdAt: {[Op.lt]: minCreatedAtDate},
          },
        ],
      },
    });
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F): Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map((results) => callback(results)));
}

function getDeletedBeforeDate() {
  const deletedBeforeDate = new Date();
  deletedBeforeDate.setHours(deletedBeforeDate.getHours() - 24);
  return deletedBeforeDate;
}

function dateToSql(date: Date) {
  const [YYYY, MM, DD, HH, mm, ss] = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ].map((v) => (v < 10 ? '0' : '') + v);
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

export default Db;
