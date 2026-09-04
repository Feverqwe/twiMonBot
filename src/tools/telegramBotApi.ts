import {
  Bot,
  RateLimiter,
  type SendMessageParams,
  type SendPhotoParams,
} from 'node-telegram-bot-api';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');
const chatActionRateLimiter = new RateLimiter({global: 30});
const messageRateLimiter = new RateLimiter({global: 30});

export const limitChatAction = (chatId: number | string) => chatActionRateLimiter.acquire(chatId);

export const sendTelegramMessage = async (api: Bot['api'], params: SendMessageParams) => {
  await messageRateLimiter.acquire(params.chat_id);
  return api.sendMessage(params);
};

export const sendRateLimitedTelegramPhoto = async (api: Bot['api'], params: SendPhotoParams) => {
  await messageRateLimiter.acquire(params.chat_id);
  return api.sendPhoto(params);
};

export const getTelegramBot = (token: string) => {
  const bot = new Bot(token);
  bot.catch((err) => {
    debug('updateError %s', err instanceof Error ? err.message : String(err));
  });
  return bot;
};

export const startTelegramPolling = (bot: Bot) => {
  void bot
    .startPolling(undefined, {
      onError: (err) => {
        debug('pollingError %s', err instanceof Error ? err.message : String(err));
      },
    })
    .catch((err) => {
      debug('pollingError %s', err instanceof Error ? err.message : String(err));
    });
};
