import {describe, expect, jest, test} from '@jest/globals';
import {type Bot, TelegramApiError} from 'node-telegram-bot-api';
import createEditOrSendNewMessage from '../../src/shared/chat/editOrSendNewMessage';

type MessageApi = Pick<Bot['api'], 'editMessageText' | 'sendMessage'>;

describe('editOrSendNewMessage', () => {
  test('returns the edited message id', async () => {
    const editMessageText = jest.fn(async (_params: unknown) => ({message_id: 42}));
    const sendMessage = jest.fn(async (_params: unknown) => ({message_id: 24}));
    const editOrSendNewMessage = createEditOrSendNewMessage({
      editMessageText,
      sendMessage,
    } as unknown as MessageApi);

    await expect(editOrSendNewMessage(1, 2, 'updated')).resolves.toBe(42);
    expect(editMessageText).toHaveBeenCalledWith({
      chat_id: 1,
      message_id: 2,
      text: 'updated',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('sends a new message when the message id is absent', async () => {
    const editMessageText = jest.fn((_params: unknown) => Promise.resolve({message_id: 42}));
    const sendMessage = jest.fn(async (_params: unknown) => ({message_id: 24}));
    const editOrSendNewMessage = createEditOrSendNewMessage({
      editMessageText,
      sendMessage,
    } as unknown as MessageApi);

    await expect(editOrSendNewMessage(1, undefined, 'new')).resolves.toBe(24);
    expect(editMessageText).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      chat_id: 1,
      text: 'new',
    });
  });
});

test.each(['Bad Request: MESSAGE_ID_INVALID', 'Bad Request: message to edit not found'])(
  'sends a replacement when Telegram rejects the old message: %s',
  async (description) => {
    const editMessageText = jest.fn(async (_params: unknown) => {
      throw new TelegramApiError(400, description);
    });
    const sendMessage = jest.fn(async (_params: unknown) => ({message_id: 24}));
    const editOrSendNewMessage = createEditOrSendNewMessage({
      editMessageText,
      sendMessage,
    } as unknown as MessageApi);

    await expect(editOrSendNewMessage(1, 2, 'new')).resolves.toBe(24);
    expect(sendMessage).toHaveBeenCalledWith({chat_id: 1, text: 'new'});
  },
);

test('keeps transient edit failures retryable without sending a duplicate', async () => {
  const error = new TelegramApiError(502, 'Bad Gateway');
  const editMessageText = jest.fn(async (_params: unknown) => {
    throw error;
  });
  const sendMessage = jest.fn(async (_params: unknown) => ({message_id: 24}));
  const editOrSendNewMessage = createEditOrSendNewMessage({
    editMessageText,
    sendMessage,
  } as unknown as MessageApi);

  await expect(editOrSendNewMessage(1, 2, 'new')).rejects.toBe(error);
  expect(sendMessage).not.toHaveBeenCalled();
});
