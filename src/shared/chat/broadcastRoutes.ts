import type {Bot} from 'node-telegram-bot-api';
import type Router from '../router';
import {getDebug} from '../tools/getDebug';
import Broadcast, {isBroadcastText} from './broadcast';
import type {BroadcastRecipient, BroadcastTexts} from './broadcast';

const debug = getDebug('app:broadcast');

export default function registerBroadcastRoutes(
  router: Router,
  api: Pick<Bot['api'], 'sendMessage'>,
  adminIds: number[],
  getRecipients: (afterId: string, limit: number) => Promise<BroadcastRecipient[]>,
  texts: BroadcastTexts,
) {
  const broadcast = new Broadcast(api, getRecipients);
  let sent = false;

  router.callback_query(/^\/broadcast$/, async (req, res) => {
    const {locale} = res;
    const reply = (text: string) => api.sendMessage({chat_id: req.chatId, text});
    if (req.chatType !== 'private' || req.fromId !== req.chatId || !adminIds.includes(req.chatId)) {
      await reply(locale.m('broadcast-private-admin'));
      return;
    }
    if (broadcast.isRunning || sent) {
      await reply(locale.m('broadcast-already-sent'));
      return;
    }
    if (!isBroadcastText(texts.ru) || !isBroadcastText(texts.en)) {
      await reply(locale.m('broadcast-empty'));
      return;
    }
    // This is a one-off announcement. Repeated clicks must not send another copy.
    sent = true;
    try {
      const result = await broadcast.send(texts);
      await reply(locale.m('broadcast-result', result));
    } catch (error) {
      debug('broadcast failed: %o', error);
      await reply(locale.m('broadcast-error'));
    }
  });

  return broadcast.stop;
}
