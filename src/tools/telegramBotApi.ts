import {Bot, RateLimiter, type Api} from 'node-telegram-bot-api';
import {fetch as undiciFetch, ProxyAgent} from 'undici';
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

export const getProxyFetch = (
  proxyUrl: string,
  fetchImpl: typeof undiciFetch = undiciFetch,
): typeof fetch | undefined => {
  if (!proxyUrl) {
    return undefined;
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  return async (input, init) => {
    const response = await fetchImpl(
      input as unknown as Parameters<typeof undiciFetch>[0],
      {...init, dispatcher} as unknown as Parameters<typeof undiciFetch>[1],
    );
    return response as unknown as Response;
  };
};

export const getTelegramBot = (token: string, proxyUrl = ''): Bot => {
  const proxyFetch = getProxyFetch(proxyUrl);
  const bot = new Bot(token, proxyFetch ? {fetch: proxyFetch} : undefined);
  applyTelegramRateLimits(bot.api);
  bot.catch((err) => {
    debug('handler error %o', err);
  });
  return bot;
};
