import {Readable} from 'node:stream';
import {describe, expect, jest, test} from '@jest/globals';
import {
  type Api,
  InputFile,
  type Context,
  type SendChatActionParams,
  type SendMessageParams,
  type SendPhotoParams,
} from 'node-telegram-bot-api';
import {applyTelegramRateLimits, getTelegramBot} from '../../src/tools/telegramBotApi';

type MockApi = {
  sendChatAction: jest.Mock<
    (params: SendChatActionParams, signal?: AbortSignal) => Promise<unknown>
  >;
  sendMessage: jest.Mock<(params: SendMessageParams, signal?: AbortSignal) => Promise<unknown>>;
  sendPhoto: jest.Mock<(params: SendPhotoParams, signal?: AbortSignal) => Promise<unknown>>;
};

const getRateLimitedMockApi = () => {
  const raw: MockApi = {
    sendChatAction: jest.fn<(params: SendChatActionParams) => Promise<unknown>>(),
    sendMessage: jest.fn<(params: SendMessageParams) => Promise<unknown>>(),
    sendPhoto: jest.fn<(params: SendPhotoParams) => Promise<unknown>>(),
  };
  const api = {...raw} as unknown as Api;
  applyTelegramRateLimits(api);
  return {api, raw};
};

describe('Telegram bot setup', () => {
  test('forwards v2 sendMessage parameters through the rate limiter', async () => {
    const {api, raw} = getRateLimitedMockApi();
    raw.sendMessage.mockResolvedValue({});

    await api.sendMessage({
      chat_id: 1,
      text: 'hello',
      link_preview_options: {is_disabled: true},
      reply_parameters: {message_id: 7},
      reply_markup: {force_reply: true},
    });

    expect(raw.sendMessage).toHaveBeenCalledWith(
      {
        chat_id: 1,
        text: 'hello',
        link_preview_options: {is_disabled: true},
        reply_parameters: {message_id: 7},
        reply_markup: {force_reply: true},
      },
      undefined,
    );
  });

  test('forwards v2 sendChatAction parameters through its rate limiter', async () => {
    const {api, raw} = getRateLimitedMockApi();
    raw.sendChatAction.mockResolvedValue(true);

    await api.sendChatAction({chat_id: 1, action: 'typing'});

    expect(raw.sendChatAction).toHaveBeenCalledWith({chat_id: 1, action: 'typing'}, undefined);
  });

  test('passes the v2 Context to update handlers', async () => {
    const bot = getTelegramBot('test-token');
    const handler = jest.fn<(ctx: Context) => void>();
    const message = {
      message_id: 1,
      date: 0,
      chat: {id: 1, type: 'private'},
      text: 'hello',
    };
    bot.on('message', handler);

    await bot.handleUpdate({update_id: 1, message});

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe(message);
  });

  test('preserves the native polling promise lifecycle', async () => {
    const bot = getTelegramBot('test-token');
    const handler = jest.fn<(ctx: Context) => void>();
    const message = {
      message_id: 2,
      date: 0,
      chat: {id: 1, type: 'private'},
      text: 'from polling',
    };
    async function* updates() {
      yield {update_id: 2, message};
    }
    bot.on('message', handler);

    const polling = bot.startPolling(updates());
    expect(bot.isRunning()).toBe(true);
    await polling;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe(message);
    expect(bot.isRunning()).toBe(false);
  });

  test('forwards InputFile photos through the send limiter', async () => {
    const {api, raw} = getRateLimitedMockApi();
    raw.sendPhoto.mockResolvedValue({});

    const photo = new InputFile(Readable.toWeb(Readable.from(Buffer.from('image'))), {
      contentType: 'image/jpeg',
      filename: 'preview.jpg',
    });
    await api.sendPhoto({chat_id: 1, photo});

    expect(raw.sendPhoto).toHaveBeenCalledWith({chat_id: 1, photo}, undefined);
    expect(photo.meta).toEqual({
      contentType: 'image/jpeg',
      filename: 'preview.jpg',
    });
  });
});
