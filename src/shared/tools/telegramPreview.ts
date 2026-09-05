import {Readable} from 'node:stream';
import {type Api, InputFile, type Message} from 'node-telegram-bot-api';
import ErrorWithCode from './errorWithCode';
import {isFileReferenceError, isSendPhotoUrlError} from './passTgEx';

export type PreviewPhotoSource = 'id' | 'url' | 'file';

interface PreviewHeadResult {
  url: string;
  contentType?: string;
}

interface PreviewDownloadResult {
  body: NodeJS.ReadableStream;
}

interface SendPreviewPhotoOptions {
  api: Pick<Api, 'sendPhoto'>;
  chatId: string;
  caption: string;
  previewUrls: string[];
  cachedFileId?: string | null;
  headUnsupported?: boolean;
  cacheKey?: string | number;
  head: (url: string) => Promise<PreviewHeadResult>;
  download: (url: string) => Promise<PreviewDownloadResult>;
  onCachedFileIdInvalid?: () => void;
  onSent?: (source: PreviewPhotoSource, message: Message) => void;
}

export interface SentPreviewPhoto {
  message: Message;
  fileId: string;
  source: PreviewPhotoSource;
}

const inflightPreviewRequests = new WeakMap<object, Promise<unknown>>();

export async function sendPreviewPhoto({
  api,
  chatId,
  caption,
  previewUrls,
  cachedFileId,
  headUnsupported,
  cacheKey,
  head,
  download,
  onCachedFileIdInvalid,
  onSent,
}: SendPreviewPhotoOptions): Promise<SentPreviewPhoto> {
  if (cachedFileId) {
    try {
      const message = await api.sendPhoto({chat_id: chatId, photo: cachedFileId, caption});
      onSent?.('id', message);
      return {message, fileId: cachedFileId, source: 'id'};
    } catch (error) {
      if (!isFileReferenceError(error)) {
        throw error;
      }
      onCachedFileIdInvalid?.();
    }
  }

  const preview = headUnsupported
    ? {url: previewUrls[0], contentType: undefined}
    : await getValidPreviewUrl(previewUrls, head);

  if (!preview.url) {
    throw new ErrorWithCode('Preview url is empty', 'INVALID_PREVIEWS');
  }

  const url = cacheKey === undefined ? preview.url : appendQueryParam(preview.url, '_', cacheKey);
  let message: Message;
  let source: PreviewPhotoSource = 'url';

  try {
    message = await api.sendPhoto({chat_id: chatId, photo: url, caption});
  } catch (error) {
    if (!isSendPhotoUrlError(error)) {
      throw error;
    }

    const response = await download(url);
    message = await api.sendPhoto({
      chat_id: chatId,
      photo: new InputFile(
        Readable.toWeb(response.body as Readable) as ReadableStream<Uint8Array>,
        {contentType: preview.contentType || 'image/jpeg', filename: '-'},
      ),
      caption,
    });
    source = 'file';
  }

  onSent?.(source, message);

  const fileId = getPhotoFileIdFromMessage(message);
  if (!fileId) {
    throw new ErrorWithCode('File id is not found', 'FILE_ID_IS_NOT_FOUND');
  }
  return {message, fileId, source};
}

export function coordinatePreviewRequest<T extends object, R>(
  item: T,
  sendPhoto: () => Promise<R>,
  sendFallback: (error: unknown) => Promise<R>,
  retryAfterInflightError: (error: unknown) => Promise<R>,
): Promise<R> {
  const inflight = inflightPreviewRequests.get(item) as Promise<R> | undefined;
  if (inflight) {
    return inflight.then(sendPhoto, retryAfterInflightError);
  }

  const request = sendPhoto().finally(() => inflightPreviewRequests.delete(item));
  inflightPreviewRequests.set(item, request);
  return request.catch(sendFallback);
}

async function getValidPreviewUrl(
  urls: string[],
  head: (url: string) => Promise<PreviewHeadResult>,
): Promise<PreviewHeadResult> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await head(url);
    } catch (error) {
      lastError = error;
    }
  }
  const error = new ErrorWithCode('Previews is invalid', 'INVALID_PREVIEWS');
  Object.assign(error, {original: lastError});
  throw error;
}

function getPhotoFileIdFromMessage(message: Message): string | null {
  const photos = message.photo?.slice().sort((a, b) => (a.file_size! > b.file_size! ? -1 : 1));
  return photos?.[0]?.file_id ?? null;
}

function appendQueryParam(url: string, key: string, value: string | number): string {
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
