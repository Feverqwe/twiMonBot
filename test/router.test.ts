import {describe, expect, test} from '@jest/globals';
import type {Message} from 'node-telegram-bot-api';
import Router from '../src/router';

describe('Router', () => {
  test('routes a bot command after initialization with only the bot name', () => {
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
    router.handle('message', message);

    expect(command).toBe('/ping');
    expect(chatId).toBe(42);
  });
});
