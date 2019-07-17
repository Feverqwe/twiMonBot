import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import arrayDifferent from "./tools/arrayDifferent";

const debug = require('debug')('app:db');
const Sequelize = require('sequelize');
const {Op} = Sequelize;
const ISOLATION_LEVELS = Sequelize.Transaction.ISOLATION_LEVELS;

class Db {
  constructor(/**Main*/main) {
    this.main = main;
    this.sequelize = new Sequelize(main.config.db.database, main.config.db.user, main.config.db.password, {
      host: main.config.db.host,
      port: main.config.db.port,
      dialect: 'mysql',
      omitNull: true,
      logging: false,
      define: {
        charset: 'utf8mb4',
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

    const Chat = this.sequelize.define('chat', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMutedRecords: {type: Sequelize.BOOLEAN, defaultValue: false},
      isEnabledAutoClean: {type: Sequelize.BOOLEAN, defaultValue: true},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
      sendTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      parentChatId: {type: Sequelize.STRING(191), allowNull: true},
    }, {
      tableName: 'chats',
      timestamps: true,
      indexes: [{
        name: 'channelId_UNIQUE',
        unique: true,
        fields: ['channelId']
      },{
        name: 'sendTimeoutExpiresAt_idx',
        fields: ['sendTimeoutExpiresAt']
      }]
    });
    Chat.belongsTo(Chat, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'channel'});
    Chat.belongsTo(Chat, {foreignKey: 'parentChatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE', as: 'parentChat'});

    const Channel = this.sequelize.define('channel', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      tableName: 'channels',
      timestamps: true,
      indexes: [{
        name: 'syncTimeoutExpiresAt_lastSyncAt_idx',
        fields: ['syncTimeoutExpiresAt', 'lastSyncAt']
      }]
    });

    const ChatIdChannelId = this.sequelize.define('chatIdChannelId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
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
    ChatIdChannelId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelId.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Stream = this.sequelize.define('stream', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      url: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.STRING(191), allowNull: false},
      game: {type: Sequelize.STRING(191), allowNull: true},
      isRecord: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      previews: {type: Sequelize.JSON, allowNull: false},
      viewers: {type: Sequelize.NUMBER, allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
      offlineFrom: {type: Sequelize.DATE, allowNull: true},
      isOffline: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      timeoutFrom: {type: Sequelize.DATE, allowNull: true},
      isTimeout: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
    }, {
      tableName: 'streams',
      timestamps: true,
      updatedAt: false,
      indexes: []
    });
    Stream.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const ChatIdStreamId = this.sequelize.define('chatIdStreamId', {
      id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      streamId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      tableName: 'chatIdStreamId',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'chatId_streamId_UNIQUE',
        unique: true,
        fields: ['chatId', 'streamId']
      },{
        name: 'chatId_idx',
        fields: ['chatId']
      }]
    });
    ChatIdStreamId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdStreamId.belongsTo(Stream, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Message = this.sequelize.define('message', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      streamId: {type: Sequelize.STRING(191), allowNull: true},
      type: {type: Sequelize.STRING(191), allowNull: false},
      text: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      tableName: 'messages',
      timestamps: true,
      updatedAt: false,
      indexes: []
    });
    Message.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    Message.belongsTo(Stream, {foreignKey: 'streamId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL'});

    this.model = {
      Channel,
      Chat,
      ChatIdChannelId,
      Stream,
      ChatIdStreamId,
      Message,
    };
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
    return this.model.Chat.findOrCreate({
      where: {id},
      include: [
        {model: this.model.Chat, as: 'channel'}
      ]
    }).then(([model, isCreated]) => {
      return model;
    });
  }

  createChatChannel(chatId, channelId) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await this.model.Chat.create({
        id: channelId,
        parentChatId: chatId,
      }, {
        transaction
      });
      await this.model.Chat.upsert({
        id: chatId,
        channelId: channelId
      }, {
        transaction
      })
    });
  }

  changeChatId(id, newId) {
    return this.model.Chat.update({id: newId}, {
      where: {id}
    });
  }

  getChatIds(offset, limit) {
    return this.model.Chat.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id) {
    return this.model.Chat.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids) {
    return this.model.Chat.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.chatSendTimeoutMinutes);
    return this.model.Chat.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  deleteChatById(id) {
    return this.model.Chat.destroy({
      where: {id}
    });
  }

  deleteChatsByIds(ids) {
    return this.model.Chat.destroy({
      where: {id: ids}
    });
  }

  cleanChats() {
    return this.model.Chat.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null
      }
    });
  }

  ensureChannel(service, rawChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    return this.model.Channel.findOrCreate({
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
    return this.model.ChatIdChannelId.findAll({
      include: [
        {model: this.model.Channel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList) => {
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids) {
    return this.model.Channel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id) {
    return this.model.Channel.findByPk(id).then((channel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId) {
    return this.model.ChatIdChannelId.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.destroy({
      where: {chatId, channelId}
    });
  }

  getChannelsForSync(limit) {
    const date = new Date();
    date.setHours(date.getHours() - this.main.config.checkChannelIfLastSyncLessThenHours);
    return this.model.Channel.findAll({
      where: {
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        lastSyncAt: {[Op.lt]: date},
      },
      limit: limit
    });
  }

  getChannelIdsByServiceId(service, offset, limit) {
    return this.model.Channel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels) => {
      return channels.map(channel => channel.id);
    });
  }

  removeChannelByIds(ids) {
    return this.model.Channel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return this.model.Channel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }
}

function bulk(results, callback) {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

export default Db;