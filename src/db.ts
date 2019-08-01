import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import Main from "./main";
import parallel from "./tools/parallel";
import {ServiceChannel, ServiceInterface} from "./checker";
// @ts-ignore
import * as Sequelize from "sequelize";

const Sequelize = require('sequelize');
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
export interface IChatWithChannel extends IChat {
  channel: IChat|null
}
class ChatModel extends Sequelize.Model {}

export interface Channel {
  id: string,
  service: string,
  title: string,
  url: string,
  lastSyncAt?: Date,
  syncTimeoutExpiresAt?: Date,
  subscriptionExpiresAt?: Date,
  subscriptionTimeoutExpiresAt?: Date,
  createdAt?: Date,
}
export interface IChannel extends Channel, Sequelize.Model {}
class ChannelModel extends Sequelize.Model {}

export interface ChatIdStreamId {
  id?: number,
  chatId: string,
  streamId: string,
  createdAt?: Date,
}
export interface IChatIdStreamId extends ChatIdStreamId, Sequelize.Model {
  id: number
}
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
  _id?: number,
  id: string,
  chatId: string,
  streamId: string,
  type: string,
  text: string,
  hasChanges?: boolean,
  createdAt?: Date,
}
export interface IMessage extends Message, Sequelize.Model {
  _id: number,
}
class MessageModel extends Sequelize.Model {}

export interface YtPubSubFeed {
  id: string,
  channelId: string,
  isStream?: boolean,
  actualStartAt?: Date,
  actualEndAt?: Date,
  hasChanges?: boolean,
  syncTimeoutExpiresAt?: Date,
}
export interface IYtPubSubFeed extends YtPubSubFeed, Sequelize.Model {}
class YtPubSubFeedModel extends Sequelize.Model {}

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
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
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
        name: 'lastSyncAt_idx',
        fields: ['lastSyncAt']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'service_syncTimeoutExpiresAt_lastSyncAt_idx',
        fields: ['service', 'syncTimeoutExpiresAt', 'lastSyncAt']
      }, {
        name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
        fields: ['subscriptionExpiresAt', 'subscriptionTimeoutExpiresAt']
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

    YtPubSubFeedModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      isStream: {type: Sequelize.BOOLEAN, allowNull: true},
      actualStartAt: {type: Sequelize.DATE, allowNull: true},
      actualEndAt: {type: Sequelize.DATE, allowNull: true},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'ytPubSubFeed',
      tableName: 'ytPubSubFeeds',
      timestamps: true,
      indexes: [{
        name: 'type_idx',
        fields: ['type']
      }, {
        name: 'actualStartAt_idx',
        fields: ['actualStartAt']
      }, {
        name: 'actualEndAt_idx',
        fields: ['actualEndAt']
      }, {
        name: 'hasChanges_idx',
        fields: ['hasChanges']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }]
    });
  }

  /**
   * @return {Promise}
   */
  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    });
  }

  ensureChat(id: string): Promise<IChatWithChannel> {
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

  getChatIds(offset: number, limit: number): Promise<string[]> {
    return ChatModel.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats: {id: string}[]) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id: string): Promise<IChat> {
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

  cleanChats(): Promise<number> {
    return ChatModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null
      }
    });
  }

  ensureChannel(service: ServiceInterface, rawChannel: ServiceChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    return ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id})
    }).then(([channel, isCreated]: [IChannel, boolean]) => {
      return channel;
    });
  }

  changeChannelId(id: string, newId: string) {
    return ChannelModel.update({id: newId}, {
      where: {id}
    });
  }

  getChatIdChannelIdChatIdCount(): Promise<number> {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(chatId)) as chatCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results: {chatCount: number}[]) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.chatCount;
    });
  }

  getChatIdChannelIdChannelIdCount(): Promise<number> {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(channelId)) as channelCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results: {channelCount: number}[]) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.channelCount;
    });
  }

  getChatIdChannelIdTop10ByServiceId(serviceId: string): Promise<{
    channelId: string, service: string, chatCount: number, title: string
  }[]> {
    return this.sequelize.query(`
      SELECT channelId, COUNT(chatId) as chatCount, channels.service as service, channels.title as title FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      WHERE channels.service = "${serviceId}"
      GROUP BY channelId ORDER BY COUNT(chatId) DESC LIMIT 10
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChannelsByChatId(chatId: string): Promise<IChannel[]> {
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

  getChannelsByIds(ids: string[]): Promise<IChannel[]> {
    return ChannelModel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id: string): Promise<IChannel> {
    return ChannelModel.findByPk(id).then((channel: IChannel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId: string): Promise<number> {
    return ChatIdChannelIdModel.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId: string, channelId: string): Promise<number> {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId}
    });
  }

  getServiceChannelsForSync(serviceId: string, limit: number): Promise<IChannel[]> {
    const date = new Date();
    date.setSeconds(date.getSeconds() - this.main.config.checkChannelIfLastSyncLessThenMinutes * 60);
    return ChannelModel.findAll({
      where: {
        service: serviceId,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      order: ['lastSyncAt'],
      limit: limit,
    });
  }

  getChannelIdsByServiceId(service: string, offset: number, limit: number): Promise<string[]> {
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
    date.setSeconds(date.getSeconds() + this.main.config.channelSyncTimeoutMinutes * 60);
    return ChannelModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
  }

  removeChannelByIds(ids: string[]) {
    return ChannelModel.destroy({where: {id: ids}});
  }

  cleanChannels(): Promise<number> {
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
        parallel(10, migratedStreamsIdCouple, ([fromId, id]) => {
          return StreamModel.update({id}, {
            where: {id: fromId},
            transaction
          });
        })
      ]);

      await bulk(syncStreams, (syncStreams) => {
        return StreamModel.bulkCreate(syncStreams, {
          updateOnDuplicate: [
            'url', 'title', 'game', 'isRecord', 'previews',
            'viewers', 'channelId', 'telegramPreviewFileId',
            'isOffline', 'offlineFrom', 'isTimeout', 'timeoutFrom'
          ],
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

  getStreamsWithChannelByChannelIds(channelIds: string[]): Promise<IStreamWithChannel[]> {
    return StreamModel.findAll({
      where: {channelId: channelIds},
      include: [
        {model: ChannelModel, required: true}
      ],
      order: ['createdAt']
    });
  }

  getStreamsByChannelIds(channelIds: string[]): Promise<IStream[]> {
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
      order: ['createdAt'],
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

  getStreamById(id: string): Promise<IStreamWithChannel> {
    return StreamModel.findOne({
      where: {id},
      include: [
        {model: ChannelModel, required: true}
      ]
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

  getDistinctMessagesChatIds(): Promise<string[]> {
    const deletedBeforeDate = getDeletedBeforeDate();
    return this.sequelize.query(`
      SELECT DISTINCT chatId FROM messages
      INNER JOIN chats ON messages.chatId = chats.id
      WHERE (
        (messages.hasChanges = 1 AND messages.streamId IS NOT NULL) OR 
        (messages.streamId IS NULL AND messages.createdAt < "${deletedBeforeDate.toISOString()}")
      ) AND chats.sendTimeoutExpiresAt < "${new Date().toISOString()}"
    `, { type: Sequelize.QueryTypes.SELECT}).then((results: {chatId: string}[]) => {
      return results.map(result => result.chatId);
    });
  }

  getMessagesByChatId(chatId: string, limit = 10): Promise<IMessage[]> {
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

  getMessagesForDeleteByChatId(chatId: string, limit = 1): Promise<IMessage[]> {
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

  getChannelIdsWithExpiresSubscription(limit: number): Promise<string[]> {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.updateChannelPubSubSubscribeIfExpiresLessThenMinutes);
    return ChannelModel.findAll({
      where: {
        service: this.main.youtube.id,
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()}
      },
      limit: limit,
      attributes: ['id']
    }).then((results: {id: string}[]) => {
      return results.map(item => item.id);
    });
  }

  setChannelsSubscriptionTimeoutExpiresAt(ids: string[]): Promise<[number]> {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.channelPubSubSubscribeTimeoutMinutes);
    return ChannelModel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionExpiresAt(ids: string[], expiresAt: Date): Promise<[number]> {
    return ChannelModel.update({subscriptionExpiresAt: expiresAt}, {
      where: {id: ids}
    });
  }

  putFeeds(feeds: YtPubSubFeed[]) {
    return YtPubSubFeedModel.bulkCreate(feeds, {
      updateOnDuplicate: ['hasChanges']
    });
  }

  getChangedFeedsWithoutOther(limit = 50): Promise<IYtPubSubFeed[]> {
    return YtPubSubFeedModel.findAll({
      where: {
        [Op.or]: [
          {isStream: null},
          {isStream: true},
        ],
        hasChanges: true,
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
      },
      limit: limit
    });
  }

  setFeedsSyncTimeoutExpiresAt(ids: string[]): Promise<void> {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.feedSyncTimeoutMinutes * 60);
    return YtPubSubFeedModel.update({
      syncTimeoutExpiresAt: date
    }, {
      where: {id: ids}
    });
  }

  updateFeeds(feedsChanges: YtPubSubFeed[], otherIds: string[]) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      return Promise.all([
        bulk(feedsChanges, (feedsChanges) => {
          return ChannelModel.bulkCreate(feedsChanges, {
            updateOnDuplicate: ['isStream', 'actualStartAt', 'actualEndAt', 'hasChanges'],
            transaction
          });
        }),
        YtPubSubFeedModel.update({isStream: false, hasChanges: false}, {
          where: {id: otherIds},
          transaction
        }),
      ]);
    });
  }

  cleanYtPubSub(): Promise<number> {
    const date = new Date();
    date.setDate(date.getDate() - this.main.config.cleanPubSubFeedIfEndedOlderThanHours);
    return YtPubSubFeedModel.destroy({
      where: {
        actualEndAt: {[Op.lt]: date},
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

export default Db;