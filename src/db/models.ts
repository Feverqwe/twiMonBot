import Sequelize from 'sequelize';
import type {
  CreationAttributes,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
} from 'sequelize';

type WithDefinedProperty<Model, Key extends keyof Model> = Model & {
  [Property in Key]-?: Exclude<Model[Property], undefined>;
};

type WithPresentProperty<Model, Key extends keyof Model> = Model & {
  [Property in Key]-?: NonNullable<Model[Property]>;
};

export class ChatModel extends Sequelize.Model<
  InferAttributes<ChatModel>,
  InferCreationAttributes<ChatModel>
> {
  declare id: string;
  declare channelId: CreationOptional<string | null>;
  declare isHidePreview: CreationOptional<boolean>;
  declare isMutedRecords: CreationOptional<boolean>;
  declare isEnabledAutoClean: CreationOptional<boolean>;
  declare isMuted: CreationOptional<boolean>;
  declare sendTimeoutExpiresAt: CreationOptional<Date>;
  declare parentChatId: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChatModel | null>;
}

export type NewChat = CreationAttributes<ChatModel>;
export type ChatModelWithChannel = WithPresentProperty<ChatModel, 'channel'>;
export type ChatModelWithOptionalChannel = WithDefinedProperty<ChatModel, 'channel'>;

export class ChannelModel extends Sequelize.Model<
  InferAttributes<ChannelModel>,
  InferCreationAttributes<ChannelModel>
> {
  declare id: string;
  declare service: string;
  declare title: string;
  declare url: string;
  declare lastStreamAt: CreationOptional<Date | null>;
  declare lastSyncAt: CreationOptional<Date>;
  declare syncTimeoutExpiresAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;

  declare channelCount?: NonAttribute<number>;
}
export type Channel = CreationAttributes<ChannelModel>;

export class ChatIdStreamIdModel extends Sequelize.Model<
  InferAttributes<ChatIdStreamIdModel>,
  InferCreationAttributes<ChatIdStreamIdModel>
> {
  declare id: CreationOptional<number>;
  declare chatId: string;
  declare streamId: string;
  declare createdAt: CreationOptional<Date>;
}
export type NewChatIdStreamId = CreationAttributes<ChatIdStreamIdModel>;

export class StreamModel extends Sequelize.Model<
  InferAttributes<StreamModel>,
  InferCreationAttributes<StreamModel>
> {
  declare id: string;
  declare url: string;
  declare title: string;
  declare game: CreationOptional<string | null>;
  declare isRecord: CreationOptional<boolean>;
  declare previews: string;
  declare viewers: CreationOptional<number | null>;
  declare channelId: string;
  declare telegramPreviewFileId: CreationOptional<string | null>;
  declare isOffline: CreationOptional<boolean>;
  declare offlineFrom: CreationOptional<Date | null>;
  declare isTimeout: CreationOptional<boolean>;
  declare timeoutFrom: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChannelModel>;
}
export type Stream = CreationAttributes<StreamModel>;
export type StreamModelWithChannel = WithPresentProperty<StreamModel, 'channel'>;

export class ChatIdChannelIdModel extends Sequelize.Model<
  InferAttributes<ChatIdChannelIdModel>,
  InferCreationAttributes<ChatIdChannelIdModel>
> {
  declare chatId: string;
  declare channelId: string;
  declare createdAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChannelModel>;
  declare chat?: NonAttribute<ChatModel>;
  declare chatCount?: NonAttribute<number>;
}
export type ChatIdChannelIdModelWithChannel = WithPresentProperty<ChatIdChannelIdModel, 'channel'>;

export class MessageModel extends Sequelize.Model<
  InferAttributes<MessageModel>,
  InferCreationAttributes<MessageModel> & {streamId: string}
> {
  declare _id: CreationOptional<number>;
  declare id: string;
  declare chatId: string;
  declare streamId: CreationOptional<string | null>;
  declare type: string;
  declare text: string;
  declare hasChanges: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export type Message = CreationAttributes<MessageModel>;
export type MessageModelWithStreamId = WithPresentProperty<MessageModel, 'streamId'>;

export class YtPubSubChannelModel extends Sequelize.Model<
  InferAttributes<YtPubSubChannelModel>,
  InferCreationAttributes<YtPubSubChannelModel>
> {
  declare id: string;
  declare channelId: string;
  declare isUpcomingChecked: CreationOptional<boolean>;
  declare lastSyncAt: CreationOptional<Date>;
  declare syncTimeoutExpiresAt: CreationOptional<Date>;
  declare subscriptionExpiresAt: CreationOptional<Date>;
  declare subscriptionTimeoutExpiresAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
}
export type YtPubSubChannel = CreationAttributes<YtPubSubChannelModel>;

export class YtPubSubFeedModel extends Sequelize.Model<
  InferAttributes<YtPubSubFeedModel>,
  InferCreationAttributes<YtPubSubFeedModel>
> {
  declare id: string;
  declare title: string;
  declare channelId: string;
  declare channelTitle: string;
  declare isStream: CreationOptional<boolean | null>;
  declare scheduledStartAt: CreationOptional<Date | null>;
  declare actualStartAt: CreationOptional<Date | null>;
  declare actualEndAt: CreationOptional<Date | null>;
  declare viewers: CreationOptional<number | null>;
  declare syncTimeoutExpiresAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
export type YtPubSubFeed = CreationAttributes<YtPubSubFeedModel>;

export function initModels(sequelize: Sequelize.Sequelize) {
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'channel',
      tableName: 'channels',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'service_lastStreamAt_idx',
          fields: ['service', 'lastStreamAt'],
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
          name: 'channelId_idx',
          fields: ['channelId'],
        },
        {
          name: 'chatId_createdAt_idx',
          fields: ['chatId', 'createdAt'],
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'stream',
      tableName: 'streams',
      timestamps: true,
      indexes: [
        {
          name: 'channelId_createdAt_idx',
          fields: ['channelId', 'createdAt'],
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
          name: 'chatId_createdAt_idx',
          fields: ['chatId', 'createdAt'],
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
        {
          name: 'chatId_streamId_createdAt_idx',
          fields: ['chatId', 'streamId', 'createdAt'],
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
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
