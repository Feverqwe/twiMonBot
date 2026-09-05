import {describe, expect, test} from '@jest/globals';
import {TelegramApiError} from 'node-telegram-bot-api';
import {isBlockedError, isSkipMessageError} from '../../src/chatSender';
import {ErrEnum, errHandler, passEx} from '../../src/shared/tools/passTgEx';

describe('Telegram API error classification', () => {
  test('matches descriptions only on TelegramApiError instances', () => {
    const telegramError = new TelegramApiError(400, 'Bad Request: message is not modified');
    const genericError = new Error('Bad Request: message is not modified');

    expect(errHandler[ErrEnum.MessageNotModified](telegramError)).toBe(true);
    expect(errHandler[ErrEnum.MessageNotModified](genericError)).toBe(false);
  });

  test('passes explicitly allowed Telegram API errors', async () => {
    const error = new TelegramApiError(400, 'Bad Request: chat not found');

    await expect(
      passEx(() => Promise.reject(error), [ErrEnum.ChatNotFound]),
    ).resolves.toBeUndefined();
  });

  test('recognizes blocked and skippable errors from structured errors', () => {
    expect(isBlockedError(new TelegramApiError(403, 'Forbidden'))).toBe(true);
    expect(isSkipMessageError(new TelegramApiError(400, 'Bad Request: TOPIC_CLOSED'))).toBe(true);
    expect(isBlockedError(new Error('403 Forbidden'))).toBe(false);
  });
});
