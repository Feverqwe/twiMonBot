import {Readable, Stream} from 'node:stream';
import {
  Bot,
  InputFile,
  RateLimiter,
  TelegramApiError,
  type CallbackQuery,
  type Message,
  type SendMessageParams,
  type SendPhotoParams,
} from 'node-telegram-bot-api';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');
const chatActionRateLimiter = new RateLimiter({global: 30});
const messageRateLimiter = new RateLimiter({global: 30});

export const limitChatAction = (chatId: number | string) => chatActionRateLimiter.acquire(chatId);

export const sendTelegramMessage = async (api: Bot['api'], params: SendMessageParams) => {
  await messageRateLimiter.acquire(params.chat_id);
  return api.sendMessage(params);
};

type PhotoOptions = Omit<SendPhotoParams, 'chat_id' | 'photo'>;
type Photo = string | NodeJS.ReadableStream | Stream;

interface FileOptions {
  filename?: string;
  contentType?: string;
}

/** Adapts the v2 client to the small positional API used by the application. */
export class TelegramBotWrapped {
  readonly api: Bot['api'];
  private readonly bot: Bot;
  private polling?: Promise<void>;

  constructor(token: string) {
    this.bot = new Bot(token);
    this.api = this.bot.api;
    this.bot.catch((err) => {
      debug('pollingError %s', err instanceof Error ? err.message : String(err));
    });
  }

  on(event: 'message', handler: (message: Message) => void): this;
  on(event: 'callback_query', handler: (query: CallbackQuery) => void): this;
  on(event: 'message' | 'callback_query', handler: (value: any) => void) {
    this.bot.on(event, (ctx) => {
      const update = ctx.update as {message?: Message; callback_query?: CallbackQuery};
      const value = update[event];
      if (value) handler(value);
    });
    return this;
  }

  async startPolling() {
    if (!this.polling) {
      this.polling = this.bot
        .startPolling(undefined, {
          onError: (err) => {
            debug('pollingError %s', err instanceof Error ? err.message : String(err));
          },
        })
        .catch((err) => {
          debug('pollingError %s', err instanceof Error ? err.message : String(err));
        });
    }
  }

  sendPhoto(
    chatId: number | string,
    photo: Photo,
    options: PhotoOptions = {},
    fileOptions: FileOptions = {},
  ) {
    return this.call(() =>
      this.bot.api.sendPhoto({
        chat_id: chatId,
        photo: toInputFile(photo, fileOptions),
        ...options,
      }),
    );
  }

  sendPhotoQuote(
    chatId: number | string,
    photo: Photo,
    options: PhotoOptions = {},
    fileOptions: FileOptions = {},
  ) {
    return messageRateLimiter
      .acquire(chatId)
      .then(() => this.sendPhoto(chatId, photo, options, fileOptions));
  }

  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof TelegramApiError) addLegacyResponse(error);
      throw error;
    }
  }
}

function toInputFile(photo: Photo, fileOptions: FileOptions): string | InputFile {
  if (typeof photo === 'string') return photo;
  const stream = Readable.toWeb(photo as Readable) as ReadableStream<Uint8Array>;
  return new InputFile(stream, fileOptions);
}

function addLegacyResponse(error: TelegramApiError) {
  Object.defineProperty(error, 'response', {
    configurable: true,
    enumerable: false,
    value: {
      statusCode: error.errorCode,
      body: {
        ok: false,
        error_code: error.errorCode,
        description: error.description,
        parameters: error.parameters,
      },
    },
  });
}

export const getTelegramBot = (token: string) => new TelegramBotWrapped(token);
