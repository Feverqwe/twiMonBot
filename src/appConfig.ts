import 'dotenv/config';

const {
  TELEGRAM_TOKEN = '',
  GA_TID = '',
  TWITCH_TOKEN = '',
  TWITCH_SECRET = '',
  YOUTUBE_TOKEN = '',
  YOUTUBE_PUBSUB_HOST = '',
  YOUTUBE_PUBSUB_PORT = '',
  YOUTUBE_PUBSUB_PATH = '',
  YOUTUBE_PUBSUB_SECRET = '',
  YOUTUBE_PUBSUB_CALLBACK_URL = '',
  WASD_TOKEN = '',
  DB_HOST = '',
  DB_PORT = '',
  DB_DATABASE = '',
  DB_USER = '',
  DB_PASSWORD = '',
  TG_ADMIN_CHAT_ID = '',
  CHANNEL_BLACKLIST = '',
} = process.env;

export const appConfig = {
  token: TELEGRAM_TOKEN,
  gaId: GA_TID,
  ytToken: YOUTUBE_TOKEN,
  twitchToken: TWITCH_TOKEN,
  twitchSecret: TWITCH_SECRET,
  wasdToken: WASD_TOKEN,
  emitCheckChannelsEveryMinutes: 5,
  checkChannelIfLastSyncLessThenMinutes: 2.5,
  channelSyncTimeoutMinutes: 2.5,
  deadChannelSyncTimeoutMinutes: 20,
  removeStreamIfOfflineMoreThanMinutes: 15,
  emitCleanChatsAndChannelsEveryHours: 1,
  emitSendMessagesEveryMinutes: 5,
  emitCheckExistsChatsEveryHours: 24,
  chatSendTimeoutAfterErrorMinutes: 1,
  emitUpdateChannelPubSubSubscribeEveryMinutes: 5,
  updateChannelPubSubSubscribeIfExpiresLessThenMinutes: 15,
  channelPubSubSubscribeTimeoutMinutes: 2.5,
  checkPubSubChannelIfLastSyncLessThenMinutes: 15,
  feedSyncTimeoutMinutes: 2.5,
  emitCleanPubSubFeedEveryHours: 1,
  cleanPubSubFeedIfEndedOlderThanHours: 1,
  defaultChannelName: 'nasa',
  webServer: {
    host: YOUTUBE_PUBSUB_HOST,
    port: Number(YOUTUBE_PUBSUB_PORT),
  },
  push: {
    path: YOUTUBE_PUBSUB_PATH,
    secret: YOUTUBE_PUBSUB_SECRET,
    callbackUrl: YOUTUBE_PUBSUB_CALLBACK_URL,
    leaseSeconds: 86400,
  },
  db: {
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_DATABASE,
    user: DB_USER,
    password: DB_PASSWORD,
  },
  adminIds: TG_ADMIN_CHAT_ID.split(',')
    .map((v) => Number(v.trim()))
    .filter(Boolean),
  channelBlackList: CHANNEL_BLACKLIST.split(',')
    .map((v) => v.trim())
    .filter(Boolean),
};
