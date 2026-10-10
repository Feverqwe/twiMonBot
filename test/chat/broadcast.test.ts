import {describe, expect, jest, test} from '@jest/globals';
import {TelegramApiError, type Bot} from 'node-telegram-bot-api';
import Broadcast, {getBroadcastText} from '../../src/shared/chat/broadcast';

const texts = {ru: 'Русский текст', en: 'English text'};
type Api = Pick<Bot['api'], 'sendMessage'>;

describe('Broadcast', () => {
  test('chooses English for missing/other languages and Russian for ru', () => {
    expect(getBroadcastText(texts)).toBe(texts.en);
    expect(getBroadcastText(texts, null)).toBe(texts.en);
    expect(getBroadcastText(texts, 'de')).toBe(texts.en);
    expect(getBroadcastText(texts, 'ru-RU')).toBe(texts.ru);
  });

  test('pages through private chats, groups and channels, continuing after failures', async () => {
    const sendMessage = jest.fn(async ({chat_id}: {chat_id: string}) => {
      if (chat_id === '-100') throw new TelegramApiError(403, 'Forbidden');
      if (chat_id === '-20') throw new Error('Network failure');
      return {message_id: 1};
    });
    const getRecipients = jest.fn(async (afterId: string) => {
      if (afterId === '') return [{id: '-100'}, {id: '-20'}];
      if (afterId === '-20') return [{id: '1'}, {id: '2', languageCode: 'ru'}];
      return [];
    });
    const broadcast = new Broadcast({sendMessage} as unknown as Api, getRecipients);
    await expect(broadcast.send(texts)).resolves.toEqual({
      sent: 2,
      blocked: 1,
      failed: 1,
      stopped: false,
    });
    expect(sendMessage.mock.calls.map(([params]) => params)).toEqual([
      {chat_id: '-100', text: texts.en},
      {chat_id: '-20', text: texts.en},
      {chat_id: '1', text: texts.en},
      {chat_id: '2', text: texts.ru},
    ]);
    expect(getRecipients.mock.calls).toEqual([
      ['', 100],
      ['-20', 100],
      ['2', 100],
    ]);
  });

  test('does not send empty texts or start overlapping broadcasts', async () => {
    let finish!: () => void;
    const sendMessage = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const getRecipients = jest.fn(async (afterId: string) => (afterId ? [] : [{id: '1'}]));
    const broadcast = new Broadcast({sendMessage} as unknown as Api, getRecipients);
    await expect(broadcast.send({ru: '', en: 'text'})).rejects.toThrow();
    const pending = broadcast.send(texts);
    await Promise.resolve();
    await expect(broadcast.send(texts)).rejects.toThrow('already running');
    finish();
    await pending;
    expect(broadcast.isRunning).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
