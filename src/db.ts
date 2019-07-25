import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import Main from "./main";
import * as Sequelize from "sequelize";
import parallel from "./tools/parallel";
import {ServiceInterface} from "./checker";

const debug = require('debug')('app:db');
const {Op} = Sequelize;
const ISOLATION_LEVELS = Sequelize.Transaction.ISOLATION_LEVELS;

export interface Chat {
  id: string,
  channelId: string,
  isHidePreview: boolean,
  isMutedRecords: boolean,
  isEnabledAutoClean: boolean,
  isMuted: boolean,
  sendTimeoutExpiresAt: Date,
  parentChatId: string|null
}
export interface IChat extends Chat, Sequelize.Model {}
class ChatModel extends Sequelize.Model {}

export interface Channel {
  id: string,
  service: string,
  title: string,
  url: string,
  lastSyncAt: Date,
  syncTimeoutExpiresAt: Date,
  createdAt?: Date,
  updatedAt?: Date,
}
export interface IChannel extends Channel, Sequelize.Model {}
class ChannelModel extends Sequelize.Model {}

export interface ChatIdStreamId {
  id?: null,
  chatId: string,
  streamId: string,
  createdAt?: Date,
}
export interface IChatIdStreamId extends ChatIdStreamId, Sequelize.Model {}
class ChatIdStreamIdModel extends Sequelize.Model {}

export interface Stream {
  id: string,
  url: string,
  title: string,
  game: string|null,
  isRecord: boolean,
  previews: string[],
  viewers: number|null,
  channelId: string,
  telegramPreviewFileId: string|null,
  offlineFrom: Date|null,
  isOffline: boolean,
  timeoutFrom: Date|null,
  isTimeout: boolean,
  createdAt?: Date,
  updatedAt?: Date,
}
export interface IStream extends Stream, Sequelize.Model {}
export interface IStreamWithChannel extends IStream {
  channel: IChannel
}
class StreamModel extends Sequelize.Model {}

export interface ChatIdChannelId {
  chatId: string,
  channelId: string,
  createdAt?: Date,
}
export interface IChatIdChannelId extends ChatIdChannelId, Sequelize.Model {}
class ChatIdChannelIdModel extends Sequelize.Model {}

export interface Message {
  id: string,
  chatId: string,
  streamId: string,
  type: string,
  text: string,
  hasChanges: boolean,
  syncTimeoutExpiresAt?: Date,
  createdAt?: Date,
}
export interface IMessage extends Message, Sequelize.Model {}
class MessageModel extends Sequelize.Model {}

class Db {
  main: Main;
  sequelize: Sequelize.Sequelize;
  constructor(main: Main) {
    this.main = main;
    this.sequelize = new Sequelize.Sequelize(main.config.db.database, main.config.db.user, main.config.db.password, {
      host: main.config.db.host,
      port: main.config.db.port,
      dialect: 'mysql',
      omitNull: true,
      logging: false,
      define: {
        charset: 'utf8mb4',
        //@ts-ignore
        dialectOptions: {
          charset: 'utf8mb4',
          collate: 'utf8mb4_general_ci'
        }
      },
      pool: {
        max: 50,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    ChatModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMutedRecords: {type: Sequelize.BOOLEAN, defaultValue: false},
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
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'channel',
      tableName: 'channels',
      timestamps: true,
      indexes: [/*{
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'lastSyncAt_idx',
        fields: ['lastSyncAt']
      }, */{
        name: 'syncTimeoutExpiresAt_lastSyncAt_idx',
        fields: ['syncTimeoutExpiresAt', 'lastSyncAt']
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
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'channelId_idx',
        fields: ['channelId']
      }, {
        name: 'chatId_channelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
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
      viewers: {type: Sequelize.NUMBER, allowNull: true},
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
      indexes: []
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
      }]
    });
    ChatIdStreamIdModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdStreamIdModel.belongsTo(StreamModel, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    MessageModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      streamId: {type: Sequelize.STRING(191), allowNull: true},
      type: {type: Sequelize.STRING(191), allowNull: false},
      text: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'message',
      tableName: 'messages',
      timestamps: true,
      updatedAt: false,
      indexes: [/*{
        name: 'hasChanges_idx',
        fields: ['hasChanges']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, */{
        name: 'hasChanges_syncTimeoutExpiresAt_idx',
        fields: ['hasChanges', 'syncTimeoutExpiresAt']
      }]
    });
    MessageModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    MessageModel.belongsTo(StreamModel, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL'});
  }

  /**
   * @return {Promise}
   */
  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    });
  }

  ensureChat(id: string) {
    return ChatModel.findOrCreate({
      where: {id},
      //@ts-ignore
      include: [
        {model: ChatModel, as: 'channel'}
      ]
    }).then(([model, isCreated]: [IChat, boolean]) => {
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
    }).then((chats: {id: string}[]) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id: string) {
    return ChatModel.findByPk(id).then((chat: IChat|null) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids: string[]): Promise<IChat[]> {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.chatSendTimeoutMinutes);
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

  ensureChannel(service: ServiceInterface, rawChannel: Channel) {
    const id = serviceId.wrap(service, rawChannel.id);

    return ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id})
    }).then(([channel, isCreated]: [IChannel, boolean]) => {
      return channel;
    });
  }

  getChatIdChannelIdChatIdCount() {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(chatId)) as chatCount, channels.service as service FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      GROUP BY channels.service
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChatIdChannelIdChannelIdCount() {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(channelId)) as channelCount, channels.service as service FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      GROUP BY channels.service
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChatIdChannelIdTop10() {
    return this.sequelize.query(`
      SELECT channelId, COUNT(chatId) as chatCount, channels.service as service, channels.title as title FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      GROUP BY channelId, channels.service ORDER BY COUNT(chatId) DESC LIMIT 10
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChannelsByChatId(chatId: string) {
    return ChatIdChannelIdModel.findAll({
      include: [
        {model: ChannelModel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList: {channel: IChannel}[]) => {
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids: string[]) {
    return ChannelModel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id: string) {
    return ChannelModel.findByPk(id).then((channel: IChannel) => {
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
    return ChatIdChannelIdModel.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId}
    });
  }

  getServiceChannelsForSync(serviceId: string, limit: number): Promise<IChannel[]> {
    const date = new Date();
    date.setMinutes(date.getMinutes() - this.main.config.checkChannelIfLastSyncLessThenMinutes);
    return ChannelModel.findAll({
      where: {
        service: serviceId,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      limit: limit
    });
  }

  getChannelIdsByServiceId(service: string, offset: number, limit: number) {
    return ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels: {id: string}[]) => {
      return channels.map(channel => channel.id);
    });
  }

  setChannelsSyncTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.channelSyncTimeoutMinutes);
    return ChannelModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
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

  getChatIdChannelIdByChannelIds(channelIds: string[]): Promise<{
    chatId: string,
    channelId: string,
    createdAt: Date,
    chat: {id: string, channelId: string|null, isMuted: boolean, isMutedRecords: boolean}
  }[]> {
    return ChatIdChannelIdModel.findAll({
      where: {channelId: channelIds},
      include: [{
        model: ChatModel,
        attributes: ['id', 'channelId', 'isMuted', 'isMutedRecords'],
        required: true
      }]
    });
  }

  putStreams(channelsChanges: object[], removedChannelIds: string[], migratedStreamsIdCouple: [string, string][], syncStreams: Stream[], changedStreamIds: string[], removedStreamIds: string[], chatIdStreamIdChanges: object[]) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        bulk(channelsChanges, (channelsChanges) => {
          return ChannelModel.bulkCreate(channelsChanges, {
            updateOnDuplicate: ['lastSyncAt', 'title'],
            transaction
          });
        }),
        parallel(50, migratedStreamsIdCouple, ([fromId, id]) => {
          return StreamModel.update({id}, {
            where: {id: fromId},
            transaction
          });
        })
      ]);

      await bulk(syncStreams, (syncStreams) => {
        return StreamModel.bulkCreate(syncStreams, {
          transaction
        });
      });

      await Promise.all([
        bulk(chatIdStreamIdChanges, (chatIdStreamIdChanges) => {
          return ChatIdStreamIdModel.bulkCreate(chatIdStreamIdChanges, {
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
    });
  }

  getStreamsByChannelIds(channelIds: string[]): Promise<IStream[]> {
    return StreamModel.findAll({
      where: {channelId: channelIds}
    });
  }

  getDistinctChatIdStreamIdChatIds(): Promise<string[]> {
    return this.sequelize.query(`
      SELECT DISTINCT chatId FROM chatIdStreamId
      INNER JOIN chats ON chatIdStreamId.chatId = chats.id
      WHERE chats.sendTimeoutExpiresAt < "${new Date().toISOString()}"
    `,  { type: Sequelize.QueryTypes.SELECT}).then((results: {chatId: string}[]) => {
      return results.map(result => result.chatId);
    });
  }

  getStreamIdsByChatId(chatId: string, limit = 10): Promise<string[]> {
    return ChatIdStreamIdModel.findAll({
      where: {chatId},
      attributes: ['streamId'],
      limit: limit,
    }).then((results: {streamId: string}[]) => {
      return results.map(chatIdStreamId => chatIdStreamId.streamId);
    });
  }

  getStreamWithChannelById(id: string): Promise<IStreamWithChannel> {
    return StreamModel.findOne({
      where: {id},
      include: [
        {model: ChannelModel, required: true}
      ]
    }).then((stream: any) => {
      if (!stream) {
        throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
      }
      return stream;
    });
  }

  getStreamById(id: string) {
    return StreamModel.findOne({
      where: {id}
    }).then((stream: IStream) => {
      if (!stream) {
        throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
      }
      return stream;
    });
  }

  deleteChatIdStreamId(chatId: string, streamId: string) {
    return ChatIdStreamIdModel.destroy({
      where: {chatId, streamId}
    });
  }

  putMessage(message: Message) {
    return MessageModel.create(message);
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F):Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

export default Db;