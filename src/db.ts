import ErrorWithCode from './tools/errorWithCode';
import arrayByPart from './tools/arrayByPart';
import serviceId from './tools/serviceId';
import Main from './main';
import parallel from './tools/parallel';
import {ServiceChannel, ServiceInterface} from './checker';
import Sequelize, {Op} from 'sequelize';
import arrayDifference from './tools/arrayDifference';
import assertType from './tools/assertType';
import {appConfig} from './appConfig';
import {getDebug} from './tools/getDebug';

const debug = getDebug('app:db');

export interface NewChat {
  id: string;
  channelId?: string | null;
  isHidePreview?: boolean;
  isMutedRecords?: boolean;
  isEnabledAutoClean?: boolean;
  isMuted?: boolean;
  sendTimeoutExpiresAt?: Date;
  parentChatId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ChatModel extends Sequelize.Model {
  declare id: string;
  declare channelId: string | null;
  declare isHidePreview: boolean;
  declare isMutedRecords: boolean;
  declare isEnabledAutoClean: boolean;
  declare isMuted: boolean;
  declare sendTimeoutExpiresAt: Date;
  declare parentChatId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export interface ChatModelWithChannel extends ChatModel {
  channel: ChatModel;
}

export interface ChatModelWithOptionalChannel extends ChatModel {
  channel: ChatModel | null;
}

export interface Channel {
  id: string;
  service: string;
  title: string;
  url: string;
  lastStreamAt?: Date | null;
  lastSyncAt?: Date;
  syncTimeoutExpiresAt?: Date;
  createdAt?: Date;
}

export class ChannelModel extends Sequelize.Model {
  declare id: string;
  declare service: string;
  declare title: string;
  declare url: string;
  declare lastStreamAt: Date | null;
  declare lastSyncAt: Date;
  declare syncTimeoutExpiresAt: Date;
  declare createdAt: Date;
}

export class ChatIdStreamIdModel extends Sequelize.Model {
  declare id: number;
  declare chatId: string;
  declare streamId: string;
  declare createdAt: Date;
}
export interface NewChatIdStreamId {
  id?: number;
  chatId: string;
  streamId: string;
  createdAt?: Date;
}

export interface Stream {
  id: string;
  url: string;
  title: string;
  game?: string | null;
  isRecord?: boolean;
  previews: string;
  viewers?: number | null;
  channelId: string;
  telegramPreviewFileId?: string | null;
  isOffline?: boolean;
  offlineFrom?: Date | null;
  isTimeout?: boolean;
  timeoutFrom?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class StreamModel extends Sequelize.Model {
  declare id: string;
  declare url: string;
  declare title: string;
  declare game: string | null;
  declare isRecord: boolean;
  declare previews: string;
  declare viewers: number | null;
  declare channelId: string;
  declare telegramPreviewFileId: string | null;
  declare isOffline: boolean;
  declare offlineFrom: Date | null;
  declare isTimeout: boolean;
  declare timeoutFrom: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export interface StreamModelWithChannel extends StreamModel {
  channel: ChannelModel;
}

export class ChatIdChannelIdModel extends Sequelize.Model {
  declare chatId: string;
  declare channelId: string;
  declare createdAt: Date;
}
export interface ChatIdChannelIdModelWithChannel extends ChatIdChannelIdModel {
  channel: ChannelModel;
}

export interface Message {
  _id?: number;
  id: string;
  chatId: string;
  streamId: string;
  type: string;
  text: string;
  hasChanges?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class MessageModel extends Sequelize.Model {
  declare _id: number;
  declare id: string;
  declare chatId: string;
  declare streamId: string;
  declare type: string;
  declare text: string;
  declare hasChanges: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export interface YtPubSubChannel {
  id: string;
  channelId: string;
  isUpcomingChecked?: boolean;
  lastSyncAt?: Date;
  syncTimeoutExpiresAt?: Date;
  subscriptionExpiresAt?: Date;
  subscriptionTimeoutExpiresAt?: Date;
  createdAt?: Date;
}

export class YtPubSubChannelModel extends Sequelize.Model {
  declare id: string;
  declare channelId: string;
  declare isUpcomingChecked: boolean;
  declare lastSyncAt: Date;
  declare syncTimeoutExpiresAt: Date;
  declare subscriptionExpiresAt: Date;
  declare subscriptionTimeoutExpiresAt: Date;
  declare createdAt: Date;
}

export interface YtPubSubFeed {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  isStream?: boolean | null;
  scheduledStartAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  viewers?: number | null;
  syncTimeoutExpiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class YtPubSubFeedModel extends Sequelize.Model {
  declare id: string;
  declare title: string;
  declare channelId: string;
  declare channelTitle: string;
  declare isStream: boolean | null;
  declare scheduledStartAt: Date | null;
  declare actualStartAt: Date | null;
  declare actualEndAt: Date | null;
  declare viewers: number | null;
  declare syncTimeoutExpiresAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

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

    ChatModel.init(
      {
        id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
        channelId: {type: Sequelize.STRING(191), allowNull: true},
        isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
        isMutedRecords: {type: Sequelize.BOOLEAN, defaultValue: true},
        isEnabledAutoClean: {type: Sequelize.BOOLEAN, defaultValue: true},
        isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
        sendTimeoutExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
        parentChatId: {type: Sequelize.STRING(191), allowNull: true},
      },
      {
        sequelize: this.sequelize,
        modelName: 'chat',
        tableName: 'chats',
        timestamps: true,
        indexes: [
          {
            name: 'channelId_UNIQUE',
            unique: true,
            fields: ['channelId'],
          },
          {
            name: 'sendTimeoutExpiresAt_idx',
            fields: ['sendTimeoutExpiresAt'],
          },
        ],
      },
    );
    ChatModel.belongsTo(ChatModel, {
      foreignKey: 'channelId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      as: 'channel',
    });
    ChatModel.belongsTo(ChatModel, {
      foreignKey: 'parentChatId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      as: 'parentChat',
    });

    ChannelModel.init(
      {
        id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
        service: {type: Sequelize.STRING(191), allowNull: false},
        title: {type: Sequelize.TEXT, allowNull: true},
        url: {type: Sequelize.TEXT, allowNull: false},
        lastStreamAt: {type: Sequelize.DATE, allowNull: true},
        lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
        syncTimeoutExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
      },
      {
        sequelize: this.sequelize,
        modelName: 'channel',
        tableName: 'channels',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'service_idx',
            fields: ['service'],
          },
          {
            name: 'lastStreamAt_idx',
            fields: ['lastStreamAt'],
          },
          {
            name: 'lastSyncAt_idx',
            fields: ['lastSyncAt'],
          },
          {
            name: 'syncTimeoutExpiresAt_idx',
            fields: ['syncTimeoutExpiresAt'],
          },
          {
            name: 'service_syncTimeoutExpiresAt_lastSyncAt_idx',
            fields: ['service', 'syncTimeoutExpiresAt', 'lastSyncAt'],
          },
        ],
      },
    );

    ChatIdChannelIdModel.init(
      {
        chatId: {type: Sequelize.STRING(191), allowNull: false},
        channelId: {type: Sequelize.STRING(191), allowNull: false},
      },
      {
        sequelize: this.sequelize,
        modelName: 'chatIdChannelId',
        tableName: 'chatIdChannelId',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'chatId_channelId_UNIQUE',
            unique: true,
            fields: ['chatId', 'channelId'],
          },
          {
            name: 'chatId_idx',
            fields: ['chatId'],
          },
          {
            name: 'channelId_idx',
            fields: ['channelId'],
          },
          {
            name: 'createdAt_idx',
            fields: ['createdAt'],
          },
        ],
      },
    );
    ChatIdChannelIdModel.belongsTo(ChatModel, {
      foreignKey: 'chatId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
    ChatIdChannelIdModel.belongsTo(ChannelModel, {
      foreignKey: 'channelId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    StreamModel.init(
      {
        id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
        url: {type: Sequelize.STRING(191), allowNull: false},
        title: {type: Sequelize.STRING(191), allowNull: false},
        game: {type: Sequelize.STRING(191), allowNull: true},
        isRecord: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
        previews: {type: Sequelize.TEXT, allowNull: false},
        viewers: {type: Sequelize.INTEGER, allowNull: true},
        channelId: {type: Sequelize.STRING(191), allowNull: false},
        telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
        isOffline: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
        offlineFrom: {type: Sequelize.DATE, allowNull: true},
        isTimeout: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
        timeoutFrom: {type: Sequelize.DATE, allowNull: true},
      },
      {
        sequelize: this.sequelize,
        modelName: 'stream',
        tableName: 'streams',
        timestamps: true,
        indexes: [
          {
            name: 'createdAt_idx',
            fields: ['createdAt'],
          },
          {
            name: 'isOffline_isRecord_idx',
            fields: ['isOffline', 'isRecord'],
          },
        ],
      },
    );
    StreamModel.belongsTo(ChannelModel, {
      foreignKey: 'channelId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    ChatIdStreamIdModel.init(
      {
        id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
        chatId: {type: Sequelize.STRING(191), allowNull: false},
        streamId: {type: Sequelize.STRING(191), allowNull: false},
      },
      {
        sequelize: this.sequelize,
        modelName: 'chatIdStreamId',
        tableName: 'chatIdStreamId',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'chatId_streamId_UNIQUE',
            unique: true,
            fields: ['chatId', 'streamId'],
          },
          {
            name: 'chatId_idx',
            fields: ['chatId'],
          },
          {
            name: 'createdAt_idx',
            fields: ['createdAt'],
          },
        ],
      },
    );
    ChatIdStreamIdModel.belongsTo(ChatModel, {
      foreignKey: 'chatId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
    ChatIdStreamIdModel.belongsTo(StreamModel, {
      foreignKey: 'streamId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
    ChatModel.hasMany(ChatIdStreamIdModel, {
      sourceKey: 'id',
      foreignKey: 'chatId',
    });

    MessageModel.init(
      {
        _id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
        id: {type: Sequelize.STRING(191), allowNull: false},
        chatId: {type: Sequelize.STRING(191), allowNull: false},
        streamId: {type: Sequelize.STRING(191), allowNull: true},
        type: {type: Sequelize.STRING(191), allowNull: false},
        text: {type: Sequelize.TEXT, allowNull: false},
        hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      },
      {
        sequelize: this.sequelize,
        modelName: 'message',
        tableName: 'messages',
        timestamps: true,
        indexes: [
          {
            name: 'id_chatId_UNIQUE',
            unique: true,
            fields: ['id', 'chatId'],
          },
          {
            name: 'createdAt_idx',
            fields: ['createdAt'],
          },
          {
            name: 'chatId_hasChanges_streamId_idx',
            fields: ['chatId', 'hasChanges', 'streamId'],
          },
          {
            name: 'chatId_hasChanges_createdAt_idx',
            fields: ['chatId', 'hasChanges', 'createdAt'],
          },
        ],
      },
    );
    MessageModel.belongsTo(ChatModel, {
      foreignKey: 'chatId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
    MessageModel.belongsTo(StreamModel, {
      foreignKey: 'streamId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    ChatModel.hasMany(MessageModel, {
      sourceKey: 'id',
      foreignKey: 'chatId',
    });

    YtPubSubChannelModel.init(
      {
        id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
        channelId: {type: Sequelize.STRING(191), allowNull: false},
        isUpcomingChecked: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
        lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
        syncTimeoutExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
        subscriptionExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
        subscriptionTimeoutExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
      },
      {
        sequelize: this.sequelize,
        modelName: 'ytPubSubChannel',
        tableName: 'ytPubSubChannels',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'lastSyncAt_idx',
            fields: ['lastSyncAt'],
          },
          {
            name: 'syncTimeoutExpiresAt_idx',
            fields: ['syncTimeoutExpiresAt'],
          },
          {
            name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
            fields: ['subscriptionExpiresAt', 'subscriptionTimeoutExpiresAt'],
          },
        ],
      },
    );
    YtPubSubChannelModel.belongsTo(ChannelModel, {
      foreignKey: 'channelId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    YtPubSubFeedModel.init(
      {
        id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
        title: {type: Sequelize.STRING(191), allowNull: false},
        channelId: {type: Sequelize.STRING(191), allowNull: false},
        channelTitle: {type: Sequelize.STRING(191), allowNull: false},
        isStream: {type: Sequelize.BOOLEAN, allowNull: true},
        scheduledStartAt: {type: Sequelize.DATE, allowNull: true},
        actualStartAt: {type: Sequelize.DATE, allowNull: true},
        actualEndAt: {type: Sequelize.DATE, allowNull: true},
        viewers: {type: Sequelize.INTEGER, allowNull: true},
        syncTimeoutExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: '1970-01-01 00:00:00',
        },
      },
      {
        sequelize: this.sequelize,
        modelName: 'ytPubSubFeed',
        tableName: 'ytPubSubFeeds',
        timestamps: true,
        indexes: [
          {
            name: 'isStream_idx',
            fields: ['isStream'],
          },
          {
            name: 'scheduledStartAt_idx',
            fields: ['scheduledStartAt'],
          },
          {
            name: 'actualStartAt_idx',
            fields: ['actualStartAt'],
          },
          {
            name: 'actualEndAt_idx',
            fields: ['actualEndAt'],
          },
          {
            name: 'syncTimeoutExpiresAt_idx',
            fields: ['syncTimeoutExpiresAt'],
          },
          {
            name: 'createdAt_idx',
            fields: ['createdAt'],
          },
        ],
      },
    );
    YtPubSubFeedModel.belongsTo(YtPubSubChannelModel, {
      foreignKey: 'channelId',
      targetKey: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  }

  /**
   * @return {Promise}
   */
  async init() {
    await this.sequelize.authenticate();
    await this.sequelize.sync();
    await this.removeChannelByIds(appConfig.channelBlackList);
  }

  async ensureChat(id: string) {
    const [model, isCreated] = await ChatModel.findOrCreate({
      where: {id},
      include: [{model: ChatModel, as: 'channel'}],
    });
    assertType<ChatModelWithOptionalChannel>(model);
    return model;
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
      defaults: Object.assign({}, rawChannel, {id, service: service.id}) as any,
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

    return results.map((value) => {
      const {channel, ...other} = value.get({plain: true});
      return {...other, ...channel};
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
      return result.get({plain: true}) as {service: string; channelCount: number};
    });
  }

  async getChannelsByChatId(chatId: string) {
    const chatIdChannelIdList: unknown[] = await ChatIdChannelIdModel.findAll({
      include: [{model: ChannelModel, required: true}],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    });
    assertType<{channel: ChannelModel}[]>(chatIdChannelIdList);
    return chatIdChannelIdList.map((chatIdChannelId) => chatIdChannelId.channel);
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
    assertType<
      (ChatIdChannelIdModel & {
        chat: Pick<ChatModel, 'id' | 'channelId' | 'isMuted' | 'isMutedRecords'>;
      })[]
    >(results);
    return results;
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
              return ChannelModel.bulkCreate(channelsChanges as any, {
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
            return StreamModel.bulkCreate(syncStreams as any, {
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
              return ChatIdStreamIdModel.bulkCreate(chatIdStreamIdChanges as any, {
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
          if (/Deadlock found when trying to get lock/.test(err.message) && --retry > 0) {
            return new Promise((r) => setTimeout(r, 250)).then(() => doTry());
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
    assertType<StreamModelWithChannel[]>(results);
    return results;
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
    assertType<StreamModelWithChannel>(stream);
    return stream;
  }

  async getStreamById(id: string) {
    const stream = await StreamModel.findOne({
      where: {id},
      include: [{model: ChannelModel, required: true}],
    });
    if (!stream) {
      throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
    }
    assertType<StreamModelWithChannel>(stream);
    return stream;
  }

  async deleteChatIdStreamId(chatId: string, streamId: string) {
    return ChatIdStreamIdModel.destroy({
      where: {chatId, streamId},
    });
  }

  async putMessage(message: Message) {
    return MessageModel.create(message as any);
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
    return MessageModel.findAll({
      where: {
        chatId,
        hasChanges: true,
        streamId: {[Op.not]: null},
      },
      order: ['createdAt'],
      limit: limit,
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
    return YtPubSubChannelModel.bulkCreate(channels as any, {
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
      return YtPubSubFeedModel.bulkCreate(feeds as any, {
        updateOnDuplicate: ['title', 'channelTitle', 'isStream'],
      });
    });
  }

  async updateFeeds(feeds: YtPubSubFeed[]) {
    return bulk(feeds, (feeds) => {
      return YtPubSubFeedModel.bulkCreate(feeds as any, {
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
