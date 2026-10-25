import {afterEach, describe, expect, jest, test} from '@jest/globals';
import {TelegramApiError} from 'node-telegram-bot-api';
import ChatSender from '../src/chatSender';
import type Main from '../src/main';
import type {ChatModel, StreamModelWithChannel} from '../src/db';

const createSender = () => {
  const messages = [1, 2].map((id) => ({
    _id: id,
    id: String(id),
    chatId: '42',
    streamId: 'tw:1',
    type: 'photo',
    text: 'old',
    update: jest.fn(async (_values: unknown) => undefined),
  }));
  const stream = {
    title: 'New title',
    game: '',
    url: 'https://example.com/stream',
    channel: {service: 'tw'},
  } as StreamModelWithChannel;
  const db = {
    getMessagesByChatId: jest.fn(async () => messages.slice()),
    deleteMessageById: jest.fn(async (_id: number) => undefined),
  };
  const main = {
    db,
    getServiceById: () => ({}),
    sender: {
      provideStream: async (
        _id: string,
        callback: (stream: StreamModelWithChannel) => Promise<void>,
      ) => callback(stream),
    },
  } as unknown as Main;
  const sender = new ChatSender(main, {id: '42'} as ChatModel);
  return {sender, db, messages};
};

describe('ChatSender message updates', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('discards an invalid message and continues updating the next message', async () => {
    const {sender, db, messages} = createSender();
    const edit = jest
      .spyOn(sender, 'updateStreamMessage')
      .mockRejectedValueOnce(new TelegramApiError(400, 'Bad Request: MESSAGE_ID_INVALID'))
      .mockResolvedValue(undefined);

    await expect(sender.update()).resolves.toBeUndefined();
    expect(db.deleteMessageById).toHaveBeenCalledWith(1);
    expect(messages[0].update).not.toHaveBeenCalled();

    await sender.update();
    expect(edit).toHaveBeenLastCalledWith('photo', '42', 2, expect.anything(), expect.any(String));
    expect(messages[1].update).toHaveBeenCalledWith({
      text: expect.stringContaining('New title'),
      hasChanges: false,
    });
    expect(db.deleteMessageById).toHaveBeenCalledTimes(1);
  });

  test('leaves a message pending when Telegram has a transient failure', async () => {
    const {sender, db, messages} = createSender();
    const error = new TelegramApiError(502, 'Bad Gateway');
    jest.spyOn(sender, 'updateStreamMessage').mockRejectedValue(error);

    await expect(sender.update()).rejects.toBe(error);
    expect(db.deleteMessageById).not.toHaveBeenCalled();
    expect(messages[0].update).not.toHaveBeenCalled();
  });
});
