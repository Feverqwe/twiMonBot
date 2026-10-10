import {describe, expect, jest, test} from '@jest/globals';
import type {Bot, CallbackQuery} from 'node-telegram-bot-api';
import Router from '../../src/shared/router';
import registerBroadcastRoutes from '../../src/shared/chat/broadcastRoutes';

function setup(texts = {ru: 'RU', en: 'EN'}) {
  const router = new Router();
  router.init('test_bot');
  const sendMessage = jest.fn(async (_params: unknown) => ({message_id: 1}));
  const recipients = jest.fn(async (afterId: string) => (afterId ? [] : [{id: '-100'}]));
  registerBroadcastRoutes(
    router,
    {sendMessage} as unknown as Pick<Bot['api'], 'sendMessage'>,
    [1],
    recipients,
    texts,
  );
  const click = (userId = 1, chatId = 1) =>
    router.handle('callback_query', {
      id: 'callback',
      chat_instance: 'test',
      data: '/broadcast',
      from: {id: userId, is_bot: false, first_name: 'Admin'},
      message: {message_id: 1, date: 0, chat: {id: chatId, type: chatId > 0 ? 'private' : 'group'}},
    } as CallbackQuery);
  return {sendMessage, recipients, click};
}

describe('Broadcast button', () => {
  test('sends on one click and rejects repeated clicks', async () => {
    const {sendMessage, click} = setup();
    await click();
    await click();
    expect(
      sendMessage.mock.calls.filter(([params]) => (params as {chat_id: string}).chat_id === '-100'),
    ).toHaveLength(1);
  });

  test('does not start before both texts are set', async () => {
    const {recipients, click} = setup({ru: '', en: ''});
    await click();
    expect(recipients).not.toHaveBeenCalled();
  });

  test('rejects non-admin users and clicks in groups', async () => {
    const {recipients, click} = setup();
    await click(2, 2);
    await click(1, -10);
    expect(recipients).not.toHaveBeenCalled();
  });
});
