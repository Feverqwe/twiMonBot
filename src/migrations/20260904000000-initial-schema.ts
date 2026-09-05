import type {Migration} from '../shared/migrator';

interface BaselineTable {
  table: string;
  create: string;
  indexes: Array<{name: string; sql: string}>;
}

const tables: BaselineTable[] = [
  {
    table: 'chats',
    create:
      "CREATE TABLE IF NOT EXISTS `chats` (`id` VARCHAR(191) NOT NULL , `channelId` VARCHAR(191), `isHidePreview` TINYINT(1) DEFAULT false, `isMutedRecords` TINYINT(1) DEFAULT true, `isEnabledAutoClean` TINYINT(1) DEFAULT true, `isMuted` TINYINT(1) DEFAULT false, `sendTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `parentChatId` VARCHAR(191), `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `chats` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`parentChatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'channelId_UNIQUE',
        sql: 'ALTER TABLE `chats` ADD UNIQUE INDEX `channelId_UNIQUE` (`channelId`)',
      },
      {
        name: 'sendTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `chats` ADD INDEX `sendTimeoutExpiresAt_idx` (`sendTimeoutExpiresAt`)',
      },
    ],
  },
  {
    table: 'channels',
    create:
      "CREATE TABLE IF NOT EXISTS `channels` (`id` VARCHAR(191) NOT NULL , `service` VARCHAR(191) NOT NULL, `title` TEXT, `url` TEXT NOT NULL, `lastStreamAt` DATETIME, `lastSyncAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `syncTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'service_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `service_idx` (`service`)',
      },
      {
        name: 'lastStreamAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `lastStreamAt_idx` (`lastStreamAt`)',
      },
      {
        name: 'lastSyncAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `lastSyncAt_idx` (`lastSyncAt`)',
      },
      {
        name: 'syncTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `syncTimeoutExpiresAt_idx` (`syncTimeoutExpiresAt`)',
      },
      {
        name: 'service_syncTimeoutExpiresAt_lastSyncAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `service_syncTimeoutExpiresAt_lastSyncAt_idx` (`service`, `syncTimeoutExpiresAt`, `lastSyncAt`)',
      },
    ],
  },
  {
    table: 'chatIdChannelId',
    create:
      'CREATE TABLE IF NOT EXISTS `chatIdChannelId` (`id` INTEGER NOT NULL auto_increment , `chatId` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`chatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`channelId`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'chatId_channelId_UNIQUE',
        sql: 'ALTER TABLE `chatIdChannelId` ADD UNIQUE INDEX `chatId_channelId_UNIQUE` (`chatId`, `channelId`)',
      },
      {
        name: 'chatId_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `chatId_idx` (`chatId`)',
      },
      {
        name: 'channelId_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `channelId_idx` (`channelId`)',
      },
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
    ],
  },
  {
    table: 'streams',
    create:
      'CREATE TABLE IF NOT EXISTS `streams` (`id` VARCHAR(191) NOT NULL , `url` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL, `game` VARCHAR(191), `isRecord` TINYINT(1) NOT NULL DEFAULT false, `previews` TEXT NOT NULL, `viewers` INTEGER, `channelId` VARCHAR(191) NOT NULL, `telegramPreviewFileId` TEXT, `isOffline` TINYINT(1) NOT NULL DEFAULT false, `offlineFrom` DATETIME, `isTimeout` TINYINT(1) NOT NULL DEFAULT false, `timeoutFrom` DATETIME, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `streams` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
      {
        name: 'isOffline_isRecord_idx',
        sql: 'ALTER TABLE `streams` ADD INDEX `isOffline_isRecord_idx` (`isOffline`, `isRecord`)',
      },
    ],
  },
  {
    table: 'chatIdStreamId',
    create:
      'CREATE TABLE IF NOT EXISTS `chatIdStreamId` (`id` INTEGER NOT NULL auto_increment , `chatId` VARCHAR(191) NOT NULL, `streamId` VARCHAR(191) NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`chatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`streamId`) REFERENCES `streams` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'chatId_streamId_UNIQUE',
        sql: 'ALTER TABLE `chatIdStreamId` ADD UNIQUE INDEX `chatId_streamId_UNIQUE` (`chatId`, `streamId`)',
      },
      {
        name: 'chatId_idx',
        sql: 'ALTER TABLE `chatIdStreamId` ADD INDEX `chatId_idx` (`chatId`)',
      },
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `chatIdStreamId` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
    ],
  },
  {
    table: 'messages',
    create:
      'CREATE TABLE IF NOT EXISTS `messages` (`_id` INTEGER NOT NULL auto_increment , `id` VARCHAR(191) NOT NULL, `chatId` VARCHAR(191) NOT NULL, `streamId` VARCHAR(191), `type` VARCHAR(191) NOT NULL, `text` TEXT NOT NULL, `hasChanges` TINYINT(1) NOT NULL DEFAULT false, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`_id`), FOREIGN KEY (`chatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`streamId`) REFERENCES `streams` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'id_chatId_UNIQUE',
        sql: 'ALTER TABLE `messages` ADD UNIQUE INDEX `id_chatId_UNIQUE` (`id`, `chatId`)',
      },
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `messages` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
      {
        name: 'chatId_hasChanges_streamId_idx',
        sql: 'ALTER TABLE `messages` ADD INDEX `chatId_hasChanges_streamId_idx` (`chatId`, `hasChanges`, `streamId`)',
      },
      {
        name: 'chatId_hasChanges_createdAt_idx',
        sql: 'ALTER TABLE `messages` ADD INDEX `chatId_hasChanges_createdAt_idx` (`chatId`, `hasChanges`, `createdAt`)',
      },
    ],
  },
  {
    table: 'ytPubSubChannels',
    create:
      "CREATE TABLE IF NOT EXISTS `ytPubSubChannels` (`id` VARCHAR(191) NOT NULL , `channelId` VARCHAR(191) NOT NULL, `isUpcomingChecked` TINYINT(1) NOT NULL DEFAULT false, `lastSyncAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `syncTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `subscriptionExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `subscriptionTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'lastSyncAt_idx',
        sql: 'ALTER TABLE `ytPubSubChannels` ADD INDEX `lastSyncAt_idx` (`lastSyncAt`)',
      },
      {
        name: 'syncTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `ytPubSubChannels` ADD INDEX `syncTimeoutExpiresAt_idx` (`syncTimeoutExpiresAt`)',
      },
      {
        name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `ytPubSubChannels` ADD INDEX `subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx` (`subscriptionExpiresAt`, `subscriptionTimeoutExpiresAt`)',
      },
    ],
  },
  {
    table: 'ytPubSubFeeds',
    create:
      "CREATE TABLE IF NOT EXISTS `ytPubSubFeeds` (`id` VARCHAR(191) NOT NULL , `title` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL, `channelTitle` VARCHAR(191) NOT NULL, `isStream` TINYINT(1), `scheduledStartAt` DATETIME, `actualStartAt` DATETIME, `actualEndAt` DATETIME, `viewers` INTEGER, `syncTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `ytPubSubChannels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'isStream_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `isStream_idx` (`isStream`)',
      },
      {
        name: 'scheduledStartAt_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `scheduledStartAt_idx` (`scheduledStartAt`)',
      },
      {
        name: 'actualStartAt_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `actualStartAt_idx` (`actualStartAt`)',
      },
      {
        name: 'actualEndAt_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `actualEndAt_idx` (`actualEndAt`)',
      },
      {
        name: 'syncTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `syncTimeoutExpiresAt_idx` (`syncTimeoutExpiresAt`)',
      },
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `ytPubSubFeeds` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
    ],
  },
];

export const up: Migration = async ({context}) => {
  for (const {table, create, indexes} of tables) {
    await context.sequelize.query(create);

    const indexesInDatabase = (await context.showIndex(table)) as Array<{name: string}>;
    const existingIndexes = new Set(indexesInDatabase.map(({name}) => name));
    for (const index of indexes) {
      if (!existingIndexes.has(index.name)) await context.sequelize.query(index.sql);
    }
  }
};
