import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import arrayDifferent from "./tools/arrayDifferent";
import Main from "./main";
import * as Sequelize from "sequelize";
import {RawStream} from "./checker";
import parallel from "./tools/parallel";

const debug = require('debug')('app:db');
const {Op} = Sequelize;
const ISOLATION_LEVELS = Sequelize.Transaction.ISOLATION_LEVELS;

class ChatModel extends Sequelize.Model {}

export interface Channel {
  id: string,
  service: string,
  title: string,
  url: string,
  lastSyncAt: Date,
  syncTimeoutExpiresAt: Date
}
export interface IChannel extends Channel, Sequelize.Model {}
class ChannelModel extends Sequelize.Model {}

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
}
export interface IStream extends Stream, Sequelize.Model {}
class StreamModel extends Sequelize.Model {}

export interface ChatIdChannelId {
  chatId: string,
  channelId: string,
  createdAt: Date,
}
export interface IChatIdChannelId extends ChatIdChannelId, Sequelize.Model {}
class ChatIdChannelIdModel extends Sequelize.Model {}

class MessageModel extends Sequelize.Model {}

class Db {
  main: Main;
  sequelize: Sequelize.Sequelize;
  constructor(/**Main*/main) {
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

  ensureChat(id) {
    return ChatModel.findOrCreate({
      where: {id},
      //@ts-ignore
      include: [
        {model: ChatModel, as: 'channel'}
      ]
    }).then(([model, isCreated]) => {
      return model;
    });
  }

  createChatChannel(chatId, channelId) {
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

  changeChatId(id, newId) {
    return ChatModel.update({id: newId}, {
      where: {id}
    });
  }

  getChatIds(offset, limit) {
    return ChatModel.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id) {
    return ChatModel.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids) {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.chatSendTimeoutMinutes);
    return ChatModel.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  deleteChatById(id) {
    return ChatModel.destroy({
      where: {id}
    });
  }

  deleteChatsByIds(ids) {
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

  ensureChannel(service, rawChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    return ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id})
    }).then(([channel, isCreated]) => {
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

  getChannelsByChatId(chatId) {
    return ChatIdChannelIdModel.findAll({
      include: [
        {model: ChannelModel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList) => {
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids) {
    return ChannelModel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id) {
    return ChannelModel.findByPk(id).then((channel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId) {
    return ChatIdChannelIdModel.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId, channelId) {
    return ChatIdChannelIdModel.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId, channelId) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId}
    });
  }

  getServiceChannelsForSync(serviceId, limit): Promise<IChannel[]> {
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

  getChannelIdsByServiceId(service, offset, limit) {
    return ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels) => {
      return channels.map(channel => channel.id);
    });
  }

  setChannelsSyncTimeoutExpiresAt(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.channelSyncTimeoutMinutes);
    return ChannelModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
  }

  removeChannelByIds(ids) {
    return ChannelModel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return ChannelModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }

  getChatIdChannelIdByChannelIds(channelIds): Promise<{
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

  putStreams(channelsChanges: object[], removedChannelIds: string[], migratedStreamsIdCouple: [string, string][], syncStreams: Stream[], removedStreamIds: string[], chatIdStreamIdChanges: object[]) {
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

      await bulk(chatIdStreamIdChanges, (chatIdStreamIdChanges) => {
        return ChatIdStreamIdModel.bulkCreate(chatIdStreamIdChanges, {
          transaction
        });
      });

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

  getStreamsByChannelIds(channelIds): Promise<IStream[]> {
    return StreamModel.findAll({
      where: {channelId: channelIds}
    });
  }

  getStreamById(id) {
    return StreamModel.findOne({
      where: {id}
    }).then((stream) => {
      if (!stream) {
        throw new ErrorWithCode('Stream is not found', 'STREAM_IS_NOT_FOUND');
      }
      return stream;
    });
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F):Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

export default Db;