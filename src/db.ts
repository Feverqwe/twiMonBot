import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import Main from "./main";
import parallel from "./tools/parallel";
import {ServiceChannel, ServiceInterface} from "./checker";
import Sequelize, {Op, Transaction} from "sequelize";
import arrayDifference from "./tools/arrayDifference";
import promiseTry from "./tools/promiseTry";
import assertType from "./tools/assertType";

const debug = require('debug')('app:db');
const ISOLATION_LEVELS = Transaction.ISOLATION_LEVELS;

export interface NewChat {
  id: string;
  channelId?: string | null;
  isHidePreview?: boolean;
  isMutedRecords?: boolean;
  isEnabledAutoClean?: boolean;
  isMuted?: boolean;
  sendTimeoutExpiresAt?: Date;
  parentChatId?: string|null;
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
  declare parentChatId: string|null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export interface ChatModelWithChannel extends ChatModel {
  channel: ChatModel,
}

export interface ChatModelWithOptionalChannel extends ChatModel {
  channel: ChatModel|null,
}

export interface Channel {
  id: string,
  service: string,
  title: string,
  url: string,
  lastStreamAt?: Date | null,
  lastSyncAt?: Date,
  syncTimeoutExpiresAt?: Date,
  createdAt?: Date,
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
  id: string,
  url: string,
  title: string,
  game?: string|null,
  isRecord?: boolean,
  previews: string[],
  viewers?: number|null,
  channelId: string,
  telegramPreviewFileId?: string|null,
  isOffline?: boolean,
  offlineFrom?: Date|null,
  isTimeout?: boolean,
  timeoutFrom?: Date|null,
  createdAt?: Date,
  updatedAt?: Date,
}

export class StreamModel extends Sequelize.Model {
  declare id: string;
  declare url: string;
  declare title: string;
  declare game: string|null;
  declare isRecord: boolean;
  declare previews: string[];
  declare viewers: number|null;
  declare channelId: string;
  declare telegramPreviewFileId: string|null;
  declare isOffline: boolean;
  declare offlineFrom: Date|null;
  declare isTimeout: boolean;
  declare timeoutFrom: Date|null;
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
  channel: ChannelModel,
}

export interface Message {
  _id?: number,
  id: string,
  chatId: string,
  streamId: string,
  type: string,
  text: string,
  hasChanges?: boolean,
  createdAt?: Date,
  updatedAt?: Date,
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
  id: string,
  channelId: string,
  isUpcomingChecked?: boolean,
  lastSyncAt?: Date,
  syncTimeoutExpiresAt?: Date,
  subscriptionExpiresAt?: Date,
  subscriptionTimeoutExpiresAt?: Date,
  createdAt?: Date,
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
  id: string,
  title: string,
  channelId: string,
  channelTitle: string,
  isStream?: boolean | null,
  scheduledStartAt?: Date | null,
  actualStartAt?: Date | null,
  actualEndAt?: Date | null,
  viewers?: number | null,
  syncTimeoutExpiresAt?: Date,
  createdAt?: Date,
  updatedAt?: Date,
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
    this.sequelize = new Sequelize.Sequelize(main.config.db.database, main.config.db.user, main.config.db.password, {
      host: main.config.db.host,
      port: main.config.db.port,
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
        idle: 10000
      }
    });

    ChatModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMutedRecords: {type: Sequelize.BOOLEAN, defaultValue: true},
      isEnabledAutoClean: {type: Sequelize.BOOLEAN, defaultValue: true},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
      sendTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      parentChatId: {type: Sequelize.STRING(191), allowNull: true},
    }, {
      sequelize: this.sequelize,
      modelName: 'chat',
      tableName: 'chats',
      timestamps: true,
      indexes: [{
        name: 'channelId_UNIQUE',
        unique: true,
        fields: ['channelId']
      }, {
        name: 'sendTimeoutExpiresAt_idx',
        fields: ['sendTimeoutExpiresAt']
      }]
    });
    ChatModel.belongsTo(ChatModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'channel'});
    ChatModel.belongsTo(ChatModel, {foreignKey: 'parentChatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE', as: 'parentChat'});

    ChannelModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      lastStreamAt: {type: Sequelize.DATE, allowNull: true},
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'channel',
      tableName: 'channels',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'service_idx',
        fields: ['service']
      }, {
        name: 'lastStreamAt_idx',
        fields: ['lastStreamAt']
      }, {
        name: 'lastSyncAt_idx',
        fields: ['lastSyncAt']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'service_syncTimeoutExpiresAt_lastSyncAt_idx',
        fields: ['service', 'syncTimeoutExpiresAt', 'lastSyncAt']
      }]
    });

    ChatIdChannelIdModel.init({
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'chatIdChannelId',
      tableName: 'chatIdChannelId',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'chatId_channelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
      }, {
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'channelId_idx',
        fields: ['channelId']
      }, {
        name: 'createdAt_idx',
        fields: ['createdAt']
      }]
    });
    ChatIdChannelIdModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelIdModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    StreamModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      url: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.STRING(191), allowNull: false},
      game: {type: Sequelize.STRING(191), allowNull: true},
      isRecord: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      previews: {type: Sequelize.JSON, allowNull: false},
      viewers: {type: Sequelize.INTEGER, allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
      isOffline: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      offlineFrom: {type: Sequelize.DATE, allowNull: true},
      isTimeout: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      timeoutFrom: {type: Sequelize.DATE, allowNull: true},
    }, {
      sequelize: this.sequelize,
      modelName: 'stream',
      tableName: 'streams',
      timestamps: true,
      indexes: [{
        name: 'createdAt_idx',
        fields: ['createdAt']
      }, {
        name: 'isOffline_isRecord_idx',
        fields: ['isOffline', 'isRecord']
      }]
    });
    StreamModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    ChatIdStreamIdModel.init({
      id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      streamId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'chatIdStreamId',
      tableName: 'chatIdStreamId',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'chatId_streamId_UNIQUE',
        unique: true,
        fields: ['chatId', 'streamId']
      }, {
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'createdAt_idx',
        fields: ['createdAt']
      }]
    });
    ChatIdStreamIdModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdStreamIdModel.belongsTo(StreamModel, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    MessageModel.init({
      _id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      id: {type: Sequelize.STRING(191), allowNull: false},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      streamId: {type: Sequelize.STRING(191), allowNull: true},
      type: {type: Sequelize.STRING(191), allowNull: false},
      text: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'message',
      tableName: 'messages',
      timestamps: true,
      indexes: [{
        name: 'id_chatId_UNIQUE',
        unique: true,
        fields: ['id', 'chatId']
      }, {
        name: 'createdAt_idx',
        fields: ['createdAt']
      }, {
        name: 'chatId_hasChanges_streamId_idx',
        fields: ['chatId', 'hasChanges', 'streamId']
      }, {
        name: 'chatId_hasChanges_createdAt_idx',
        fields: ['chatId', 'hasChanges', 'createdAt']
      }]
    });
    MessageModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    MessageModel.belongsTo(StreamModel, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL'});

    YtPubSubChannelModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      isUpcomingChecked: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'ytPubSubChannel',
      tableName: 'ytPubSubChannels',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'lastSyncAt_idx',
        fields: ['lastSyncAt']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
        fields: ['subscriptionExpiresAt', 'subscriptionTimeoutExpiresAt']
      }]
    });
    YtPubSubChannelModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    YtPubSubFeedModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      title: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      channelTitle: {type: Sequelize.STRING(191), allowNull: false},
      isStream: {type: Sequelize.BOOLEAN, allowNull: true},
      scheduledStartAt: {type: Sequelize.DATE, allowNull: true},
      actualStartAt: {type: Sequelize.DATE, allowNull: true},
      actualEndAt: {type: Sequelize.DATE, allowNull: true},
      viewers: {type: Sequelize.INTEGER, allowNull: true},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'ytPubSubFeed',
      tableName: 'ytPubSubFeeds',
      timestamps: true,
      indexes: [{
        name: 'isStream_idx',
        fields: ['isStream']
      }, {
        name: 'scheduledStartAt_idx',
        fields: ['scheduledStartAt']
      }, {
        name: 'actualStartAt_idx',
        fields: ['actualStartAt']
      }, {
        name: 'actualEndAt_idx',
        fields: ['actualEndAt']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'createdAt_idx',
        fields: ['createdAt']
      }]
    });
    YtPubSubFeedModel.belongsTo(YtPubSubChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
  }

  /**
   * @return {Promise}
   */
  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    }).then(() => {
      return this.removeChannelByIds(this.main.config.channelBlackList);
    });
  }

  ensureChat(id: string) {
    return ChatModel.findOrCreate({
      where: {id},
      include: [
        {model: ChatModel, as: 'channel'}
      ]
    }).then(([model, isCreated]) => {
      assertType<ChatModelWithOptionalChannel>(model);
      return model;
    });
  }

  createChatChannel(chatId: string, channelId: string) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await ChatModel.create({
        id: channelId,
        parentChatId: chatId,
      }, {
        transaction
      });
      await ChatModel.upsert({
        id: chatId,
        channelId: channelId
      }, {
        transaction
      })
    });
  }

  changeChatId(id: string, newId: string) {
    return ChatModel.update({id: newId}, {
      where: {id}
    });
  }

  getChatIds(offset: number, limit: number) {
    return ChatModel.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats: Pick<ChatModel, 'id'>[]) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id: string) {
    return ChatModel.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids: string[]) {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.chatSendTimeoutAfterErrorMinutes * 60);
    return ChatModel.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  deleteChatById(id: string) {
    return ChatModel.destroy({
      where: {id}
    });
  }

  deleteChatsByIds(ids: string[]) {
    return ChatModel.destroy({
      where: {id: ids}
    });
  }

  cleanChats() {
    return ChatModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null
      }
    });
  }

  async ensureChannel(service: ServiceInterface, rawChannel: ServiceChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    if (this.main.config.channelBlackList.includes(id)) {
      throw new ErrorWithCode('Channel in black list', 'CHANNEL_IN_BLACK_LIST');
    }

    return ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id}) as any,
    }).then(([channel, isCreated]) => {
      return channel;
    });
  }

  hasChannelByServiceRawId(service: ServiceInterface, rawChannelId: string|number) {
    const id = serviceId.wrap(service, rawChannelId);

    return ChannelModel.findOne({
      where: {id},
      attributes: ['id'],
    }).then((channel: Pick<ChannelModel, 'id'> | null) => {
      return channel !== null;
    });
  }

  changeChannelId(id: string, newId: string) {
    return ChannelModel.update({id: newId}, {
      where: {id}
    });
  }

  getChatIdChannelIdChatIdCount() {
    return this.sequelize.query<{chatCount: number}>(`
      SELECT COUNT(DISTINCT(chatId)) as chatCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.chatCount;
    });
  }

  getChatIdChannelIdChannelIdCount() {
    return this.sequelize.query<{channelCount: number}>(`
      SELECT COUNT(DISTINCT(channelId)) as channelCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.channelCount;
    });
  }

  getChatIdChannelIdTop10ByServiceId(serviceId: string) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return this.sequelize.query<{
      channelId: string, service: string, chatCount: number, title: string
    }>(`
      SELECT channelId, COUNT(chatId) as chatCount, channels.service as service, channels.title as title FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      WHERE channels.service = "${serviceId}" AND channels.lastStreamAt > "${dateToSql(monthAgo)}"
      GROUP BY channelId ORDER BY COUNT(chatId) DESC LIMIT 10
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getServiceIdChannelCount(serviceId: string) {
    return promiseTry(() => {
      return this.sequelize.query<{service: string, channelCount: number}>(`
      SELECT service, COUNT(id) as channelCount FROM channels 
      WHERE service = "${serviceId}"
    `, {type: Sequelize.QueryTypes.SELECT});
    }).then((results) => {
      return results[0];
    });
  }

  getChannelsByChatId(chatId: string) {
    return ChatIdChannelIdModel.findAll({
      include: [
        {model: ChannelModel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList: {}[]) => {
      assertType<{channel: ChannelModel}[]>(chatIdChannelIdList);
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids: string[]) {
    return ChannelModel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id: string) {
    return ChannelModel.findByPk(id).then((channel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId: string) {
    return ChatIdChannelIdModel.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.upsert({chatId, channelId}).then(([model, isCreated]) => {
      return isCreated as boolean; // cause mariadb
    });
  }

  deleteChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId}
    });
  }

  getServiceChannelsForSync(serviceId: string, limit: number) {
    const date = new Date();
    date.setSeconds(date.getSeconds() - this.main.config.checkChannelIfLastSyncLessThenMinutes * 60);
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

  getChannelIdsByServiceId(service: string, offset: number, limit: number) {
    return ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels: Pick<ChannelModel, 'id'>[]) => {
      return channels.map(channel => channel.id);
    });
  }

  setChannelsSyncTimeoutExpiresAt(ids: string[]) {
    const aliveTimeout = new Date();
    aliveTimeout.setSeconds(aliveTimeout.getSeconds() + this.main.config.channelSyncTimeoutMinutes * 60);

    const deadTimeout = new Date();
    deadTimeout.setSeconds(deadTimeout.getSeconds() + this.main.config.deadChannelSyncTimeoutMinutes * 60);

    const channelIsDeadFromDate = new Date();
    channelIsDeadFromDate.setMonth(channelIsDeadFromDate.getMonth() - 3);

    return Promise.all([
      ChannelModel.update({
        syncTimeoutExpiresAt: aliveTimeout
      }, {
        where: {
          id: ids,
          [Op.or]: [
            {lastStreamAt: {[Op.gt]: channelIsDeadFromDate}},
            {
              lastStreamAt: null,
              createdAt: {[Op.gt]: channelIsDeadFromDate}
            }
          ]
        }
      }),
      ChannelModel.update({
        syncTimeoutExpiresAt: deadTimeout
      }, {
        where: {
          id: ids,
          [Op.or]: [
            {lastStreamAt: {[Op.lte]: channelIsDeadFromDate}},
            {
              lastStreamAt: null,
              createdAt: {[Op.lte]: channelIsDeadFromDate}
            }
          ]
        },
      }),
    ]);
  }

  removeChannelByIds(ids: string[]) {
    return ChannelModel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return ChannelModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }

  getChatIdChannelIdByChannelIds(channelIds: string[]) {
    return ChatIdChannelIdModel.findAll({
      where: {channelId: channelIds},
      include: [{
        model: ChatModel,
        attributes: ['id', 'channelId', 'isMuted', 'isMutedRecords'],
        required: true
      }]
    }).then((results) => {
      assertType<(ChatIdChannelIdModel & {
        chat: Pick<ChatModel, 'id' | 'channelId' | 'isMuted' | 'isMutedRecords'>,
      })[]>(results);
      return results;
    });
  }

  putStreams(channelsChanges: Channel[], removedChannelIds: string[], migratedStreamsIdCouple: [string, string][], syncStreams: Stream[], changedStreamIds: string[], removedStreamIds: string[], chatIdStreamIdChanges: NewChatIdStreamId[]) {
    let retry = 3;

    const doTry = (): Promise<void> => {
      return this.sequelize.transaction({
        isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
      }, async (transaction) => {
        await Promise.all([
          bulk(channelsChanges, (channelsChanges) => {
            return ChannelModel.bulkCreate(channelsChanges as any, {
              updateOnDuplicate: ['lastStreamAt', 'lastSyncAt', 'title', 'url'],
              transaction
            });
          }),
          parallel(10, migratedStreamsIdCouple, ([fromId, id]) => {
            return StreamModel.update({id}, {
              where: {id: fromId},
              transaction
            });
          })
        ]);

        await bulk(syncStreams, (syncStreams) => {
          return StreamModel.bulkCreate(syncStreams as any, {
            updateOnDuplicate: [
              'url', 'title', 'game', 'isRecord', 'previews',
              'viewers', 'channelId', 'telegramPreviewFileId',
              'isOffline', 'offlineFrom', 'isTimeout', 'timeoutFrom', 'updatedAt'
            ],
            transaction
          });
        });

        await Promise.all([
          bulk(chatIdStreamIdChanges, (chatIdStreamIdChanges) => {
            return ChatIdStreamIdModel.bulkCreate(chatIdStreamIdChanges as any, {
              transaction
            });
          }),
          bulk(changedStreamIds, (changedStreamIds) => {
            return MessageModel.update({hasChanges: true}, {
              where: {streamId: changedStreamIds},
              transaction
            });
          })
        ]);

        await Promise.all([
          bulk(removedStreamIds, (removedStreamIds) => {
            return StreamModel.destroy({
              where: {id: removedStreamIds},
              transaction
            });
          }),
          bulk(removedChannelIds, (removedChannelIds) => {
            return ChannelModel.destroy({
              where: {id: removedChannelIds},
              transaction
            });
          })
        ]);
      }).catch((err) => {
        if (/Deadlock found when trying to get lock/.test(err.message) && --retry > 0) {
          return new Promise(r => setTimeout(r, 250)).then(() => doTry());
        }
        throw err;
      });
    };

    return doTry();
  }

  getStreamsWithChannelByChannelIds(channelIds: string[]) {
    return StreamModel.findAll({
      where: {channelId: channelIds},
      include: [
        {model: ChannelModel, required: true}
      ],
      order: ['createdAt']
    }).then((results) => {
      assertType<StreamModelWithChannel[]>(results);
      return results;
    });
  }

  getStreamsByChannelIds(channelIds: string[]) {
    return StreamModel.findAll({
      where: {channelId: channelIds}
    });
  }

  getOnlineStreamCount() {
    return StreamModel.count({
      where: {
        isOffline: false,
        isRecord: false
      }
    });
  }

  getDistinctChatIdStreamIdChatIds() {
    return this.sequelize.query<{chatId: string}>(`
      SELECT DISTINCT chatId FROM chatIdStreamId
      INNER JOIN chats ON chatIdStreamId.chatId = chats.id
      WHERE chats.sendTimeoutExpiresAt < "${dateToSql(new Date())}"
    `,  { type: Sequelize.QueryTypes.SELECT}).then((results) => {
      return results.map(result => result.chatId);
    });
  }

  getStreamIdsByChatId(chatId: string, limit = 10) {
    return ChatIdStreamIdModel.findAll({
      where: {chatId},
      attributes: ['streamId'],
      order: ['createdAt'],
      limit: limit,
    }).then((results: Pick<ChatIdStreamIdModel, "streamId">[]) => {
      return results.map(chatIdStreamId => chatIdStreamId.streamId);
    });
  }

  getStreamWithChannelById(id: string) {
    return StreamModel.findOne({
      where: {id},
      include: [
        {model: ChannelModel, required: true}
      ]
    }).then((stream) => {
      if (!stream) {
        throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
      }
      assertType<StreamModelWithChannel>(stream);
      return stream;
    });
  }

  getStreamById(id: string) {
    return StreamModel.findOne({
      where: {id},
      include: [
        {model: ChannelModel, required: true}
      ]
    }).then((stream) => {
      if (!stream) {
        throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
      }
      assertType<StreamModelWithChannel>(stream);
      return stream;
    });
  }

  deleteChatIdStreamId(chatId: string, streamId: string) {
    return ChatIdStreamIdModel.destroy({
      where: {chatId, streamId}
    });
  }

  putMessage(message: Message) {
    return MessageModel.create(message as any);
  }

  getDistinctMessagesChatIds() {
    const deletedBeforeDate = getDeletedBeforeDate();
    return this.sequelize.query<{chatId: string}>(`
      SELECT DISTINCT chatId FROM messages
      INNER JOIN chats ON messages.chatId = chats.id
      WHERE (
        (messages.hasChanges = 1 AND messages.streamId IS NOT NULL) OR 
        (messages.streamId IS NULL AND messages.createdAt < "${dateToSql(deletedBeforeDate)}")
      ) AND chats.sendTimeoutExpiresAt < "${dateToSql(new Date())}"
    `, { type: Sequelize.QueryTypes.SELECT}).then((results) => {
      return results.map(result => result.chatId);
    });
  }

  getMessagesByChatId(chatId: string, limit = 10) {
    return MessageModel.findAll({
      where: {
        chatId,
        hasChanges: true,
        streamId: {[Op.not]: null}
      },
      order: ['createdAt'],
      limit: limit,
    });
  }

  getMessagesForDeleteByChatId(chatId: string, limit = 1) {
    const deletedBeforeDate = getDeletedBeforeDate();
    return MessageModel.findAll({
      where: {
        chatId,
        streamId: null,
        createdAt: {[Op.lt]: deletedBeforeDate}
      },
      order: ['createdAt'],
      limit: limit,
    });
  }

  deleteMessageById(_id: number) {
    return MessageModel.destroy({
      where: {_id}
    });
  }

  getExistsYtPubSubChannelIds(channelIds: string[]) {
    return YtPubSubChannelModel.findAll({
      where: {
        id: channelIds
      },
      attributes: ['id']
    }).then((results: Pick<YtPubSubChannelModel, 'id'>[]) => {
      return results.map(item => item.id);
    });
  }

  getNotExistsYtPubSubChannelIds(channelIds: string[]) {
    return this.getExistsYtPubSubChannelIds(channelIds).then((existsChannelIds) => {
      return arrayDifference(channelIds, existsChannelIds);
    });
  }

  ensureYtPubSubChannels(channels: YtPubSubChannel[]) {
    return YtPubSubChannelModel.bulkCreate(channels as any, {
      updateOnDuplicate: ['id']
    });
  }

  getYtPubSubChannelIdsForSync(channelIds: string[]) {
    const date = new Date();
    date.setMinutes(date.getMinutes() - this.main.config.checkPubSubChannelIfLastSyncLessThenMinutes);
    return YtPubSubChannelModel.findAll({
      where: {
        id: channelIds,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      order: ['lastSyncAt'],
      attributes: ['id'],
    }).then((results: Pick<YtPubSubChannelModel, 'id'>[]) => {
      return results.map(({id}) => id);
    });
  }

  getYtPubSubChannelsByIds(ids: string[]) {
    return YtPubSubChannelModel.findAll({
      where: {id: ids}
    });
  }

  setYtPubSubChannelsSyncTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.channelSyncTimeoutMinutes * 60);
    return YtPubSubChannelModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
  }

  getYtPubSubChannelIdsWithExpiresSubscription(limit = 50) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.updateChannelPubSubSubscribeIfExpiresLessThenMinutes);
    return YtPubSubChannelModel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()}
      },
      limit: limit,
      attributes: ['id']
    }).then((results: Pick<YtPubSubChannelModel, 'id'>[]) => {
      return results.map(item => item.id);
    });
  }

  setYtPubSubChannelsSubscriptionTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.channelPubSubSubscribeTimeoutMinutes * 60);
    return YtPubSubChannelModel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  setYtPubSubChannelsSubscriptionExpiresAt(ids: string[], expiresAt: Date) {
    return YtPubSubChannelModel.update({subscriptionExpiresAt: expiresAt}, {
      where: {id: ids}
    });
  }

  setYtPubSubChannelsLastSyncAt(ids: string[], syncAt: Date) {
    return YtPubSubChannelModel.update({lastSyncAt: syncAt, isUpcomingChecked: true}, {
      where: {id: ids}
    });
  }

  getFeedIdsForSync(channelIds: string[]) {
    const minEndTime = new Date();
    minEndTime.setHours(minEndTime.getHours() - 1);
    return YtPubSubFeedModel.findAll({
      where: {
        channelId: channelIds,
        [Op.or]: [{
          isStream: null
        }, {
          isStream: true,
          [Op.or]: [
            {actualEndAt: null},
            {actualEndAt: {[Op.gt]: minEndTime}},
          ]
        }],
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
      },
      attributes: ['id'],
    }).then((results: Pick<YtPubSubFeedModel, 'id'>[]) => {
      return results.map(({id}) => id);
    });
  }

  getFeedsByIds(ids: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {id: ids}
    });
  }

  getExistsFeedIds(ids: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {id: ids},
      attributes: ['id']
    }).then((results: Pick<YtPubSubFeedModel, 'id'>[]) => {
      return results.map(result => result.id);
    });
  }

  getExistsFeeds(ids: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {id: ids},
      attributes: ['id', 'isStream']
    }).then((results: Pick<YtPubSubFeedModel, 'id' | 'isStream'>[]) => {
      return results;
    });
  }

  getStreamFeedsByChannelIds(channelIds: string[]) {
    return YtPubSubFeedModel.findAll({
      where: {
        channelId: channelIds,
        isStream: true,
        actualStartAt: {[Op.not]: null},
        actualEndAt: null,
      }
    });
  }

  setFeedsSyncTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.feedSyncTimeoutMinutes * 60);
    return YtPubSubFeedModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
  }

  putFeeds(feeds: YtPubSubFeed[]) {
    return bulk(feeds, (feeds) => {
      return YtPubSubFeedModel.bulkCreate(feeds as any, {
        updateOnDuplicate: ['title', 'channelTitle', 'isStream']
      });
    });
  }

  updateFeeds(feeds: YtPubSubFeed[]) {
    return bulk(feeds, (feeds) => {
      return YtPubSubFeedModel.bulkCreate(feeds as any, {
        updateOnDuplicate: ['isStream', 'scheduledStartAt', 'actualStartAt', 'actualEndAt', 'viewers']
      });
    });
  }

  cleanYtPubSub() {
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
        [Op.or]: [{
          isStream: true,
          [Op.or]: [{
            actualEndAt: {[Op.lt]: minStreamEndAtDate}
          }, {
            actualStartAt: null,
            actualEndAt: null,
            [Op.or]: [{
              scheduledStartAt: {[Op.lt]: minStreamScheduledStartAtDate},
            }, {
              scheduledStartAt: null,
              createdAt: {[Op.lt]: minStreamCreatedAtDate}
            }]
          }]
        }, {
          isStream: false,
          createdAt: {[Op.lt]: minCreatedAtDate}
        }]
      }
    });
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F):Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

function getDeletedBeforeDate() {
  const deletedBeforeDate = new Date();
  deletedBeforeDate.setHours(deletedBeforeDate.getHours() - 24);
  return deletedBeforeDate;
}

function dateToSql(date: Date) {
  const [YYYY, MM, DD, HH, mm, ss] = [
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()
  ].map(v => ((v < 10) ? '0' : '') + v);
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

export default Db;
