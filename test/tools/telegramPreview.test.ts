import {Readable} from 'node:stream';
import {describe, expect, jest, test} from '@jest/globals';
import {type Api, InputFile, type Message} from 'node-telegram-bot-api';
import {sendPreviewPhoto} from '../../src/shared/tools/telegramPreview';

const messageWithPhoto = (fileId: string) =>
  ({
    message_id: 1,
    photo: [
      {file_id: 'small', file_unique_id: 'small', width: 10, height: 10, file_size: 10},
      {file_id: fileId, file_unique_id: fileId, width: 20, height: 20, file_size: 20},
    ],
  }) as Message;

describe('Telegram preview delivery', () => {
  test('uses a cached Telegram file id without requesting the preview', async () => {
    const sendPhoto = jest.fn(async () => messageWithPhoto('cached'));
    const head = jest.fn(async () => ({url: 'https://example.com/preview.jpg'}));
    const download = jest.fn(async () => ({body: Readable.from('image')}));

    const result = await sendPreviewPhoto({
      api: {sendPhoto} as never,
      chatId: '1',
      caption: 'caption',
      previewUrls: [],
      cachedFileId: 'cached',
      head,
      download,
    });

    expect(result.source).toBe('id');
    expect(result.fileId).toBe('cached');
    expect(head).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  test('rejects an empty preview list when HEAD is unsupported', async () => {
    const promise = sendPreviewPhoto({
      api: {sendPhoto: jest.fn()} as never,
      chatId: '1',
      caption: 'caption',
      previewUrls: [],
      headUnsupported: true,
      head: async (url) => ({url}),
      download: async () => ({body: Readable.from('image')}),
    });

    await expect(promise).rejects.toMatchObject({code: 'INVALID_PREVIEWS'});
  });

  test('downloads a preview when Telegram cannot fetch its URL', async () => {
    const sendPhoto = jest
      .fn<Api['sendPhoto']>()
      .mockRejectedValueOnce(new Error('failed to get HTTP URL content'))
      .mockResolvedValueOnce(messageWithPhoto('uploaded'));
    const download = jest.fn(async (url: string) => {
      void url;
      return {body: Readable.from('image')};
    });

    const result = await sendPreviewPhoto({
      api: {sendPhoto} as never,
      chatId: '1',
      caption: 'caption',
      previewUrls: ['https://example.com/preview.jpg'],
      head: async (url) => ({url, contentType: 'image/jpeg'}),
      download,
    });

    expect(result.source).toBe('file');
    expect(result.fileId).toBe('uploaded');
    expect(download).toHaveBeenCalledWith('https://example.com/preview.jpg');
    expect(sendPhoto.mock.calls[1]?.[0]?.photo).toBeInstanceOf(InputFile);
  });
});
