import {Bot, RateLimiter, type Api} from 'node-telegram-bot-api';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');

export function applyTelegramRateLimits(api: Api): void {
  const sendLimit = new RateLimiter({global: 30});
  const chatActionLimit = new RateLimiter({global: 30});
  const sendChatAction = api.sendChatAction.bind(api);
  const sendMessage = api.sendMessage.bind(api);
  const sendPhoto = api.sendPhoto.bind(api);

  api.sendChatAction = async (params, signal) => {
    await chatActionLimit.acquire(params.chat_id, signal);
    return sendChatAction(params, signal);
  };
  api.sendMessage = async (params, signal) => {
    await sendLimit.acquire(params.chat_id, signal);
    return sendMessage(params, signal);
  };
  api.sendPhoto = async (params, signal) => {
    await sendLimit.acquire(params.chat_id, signal);
    return sendPhoto(params, signal);
  };
}

export const getTelegramBot = (token: string): Bot => {
  const bot = new Bot(token);
  applyTelegramRateLimits(bot.api);
  bot.catch((err) => {
    debug('handler error %o', err);
  });
  return bot;
};
