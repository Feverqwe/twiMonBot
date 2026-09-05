import type {Bot} from 'node-telegram-bot-api';
import Locale from '../locale';
import Router, {RouterReq, RouterRes} from '../router';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Chat');

export interface WithChat<TChat> {
  chat: TChat;
}

export interface WithChannels<TChannel> {
  channels: TChannel[];
}

interface UserMiddlewareOptions<TChat, TChannel> {
  router: Router;
  api: Pick<Bot['api'], 'sendMessage'>;
  ensureChat(chatId: string): Promise<TChat>;
  getChannels(chatId: string): Promise<TChannel[]>;
  getUnknownErrorText(locale: Locale): string;
  getEmptyChannelsText(locale: Locale): string;
}

export default function createUserMiddlewares<TChat, TChannel>({
  router,
  api,
  ensureChat,
  getChannels,
  getUnknownErrorText,
  getEmptyChannelsText,
}: UserMiddlewareOptions<TChat, TChannel>) {
  const provideChat = router.middleware<WithChat<TChat>>(async (req, res, next) => {
    const {locale} = res;
    const {chatId} = req;
    if (!chatId) return;

    try {
      try {
        const chat = await ensureChat(String(chatId));
        Object.assign(req, {chat});
        next();
      } catch (err) {
        debug('ensureChat error: %o', err);
        await api.sendMessage({
          chat_id: chatId,
          text: getUnknownErrorText(locale),
        });
      }
    } catch (err) {
      debug('provideChat error: %o', err);
    }
  });

  const provideChannels = router.middleware<WithChannels<TChannel>>(async (req, res, next) => {
    const {locale} = res;
    const {chatId} = req;
    if (!chatId) return;

    try {
      try {
        const channels = await getChannels(String(chatId));
        Object.assign(req, {channels});
        next();
      } catch (err) {
        debug('getChannelsByChatId error: %o', err);
        await api.sendMessage({
          chat_id: chatId,
          text: getUnknownErrorText(locale),
        });
      }
    } catch (err) {
      debug('provideChannels error: %o', err);
    }
  });

  const withChannels = async (
    req: RouterReq & WithChannels<TChannel>,
    res: RouterRes,
    next: () => void,
  ) => {
    const {locale} = res;
    const {chatId} = req;
    if (!chatId) return;

    if (req.channels.length) {
      next();
      return;
    }

    try {
      await api.sendMessage({
        chat_id: chatId,
        text: getEmptyChannelsText(locale),
      });
    } catch (err) {
      debug('withChannels sendMessage error: %o', err);
    }
  };

  return {provideChat, provideChannels, withChannels};
}
