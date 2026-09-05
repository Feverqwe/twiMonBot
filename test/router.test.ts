import {describe, expect, jest, test} from '@jest/globals';
import type {Message} from 'node-telegram-bot-api';
import Router from '../src/shared/router';

describe('Router', () => {
  test('routes a bot command after initialization with only the bot name', async () => {
    const router = new Router();
    const message: Message = {
      message_id: 1,
      date: 0,
      chat: {id: 42, type: 'private'},
      text: '/ping',
      entities: [{type: 'bot_command', offset: 0, length: 5}],
    };
    let command: string | undefined;
    let chatId: number | undefined;
    router.text(/\/ping/, (req) => {
      command = req.command;
      chatId = req.chatId;
    });

    router.init('test_bot');
    await router.handle('message', message);

    expect(command).toBe('/ping');
    expect(chatId).toBe(42);
  });

  test('waits for async handlers and catches their rejections', async () => {
    const router = new Router();
    const message: Message = {
      message_id: 1,
      date: 0,
      chat: {id: 42, type: 'private'},
      text: 'hello',
    };
    const handler = jest.fn(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error('handler failed');
    });
    router.text(handler);

    router.init('test_bot');
    await expect(router.handle('message', message)).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
