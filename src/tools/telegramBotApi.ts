import {Readable, Stream} from 'node:stream';
import {
  Bot,
  InputFile,
  RateLimiter,
  TelegramApiError,
  type CallbackQuery,
  type DeleteMessageResult,
  type EditMessageCaptionParams,
  type EditMessageReplyMarkupParams,
  type EditMessageTextParams,
  type InlineKeyboardMarkup,
  type Message,
  type SendMessageParams,
  type SendPhotoParams,
} from 'node-telegram-bot-api';
import RateLimit2 from './rateLimit2';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');
const chatActionRateLimiter = new RateLimiter({global: 30});

export const limitChatAction = (chatId: number | string) => chatActionRateLimiter.acquire(chatId);

type MessageOptions = Omit<SendMessageParams, 'chat_id' | 'text'> & {
  disable_web_page_preview?: boolean;
};
type EditMessageTextOptions = Omit<EditMessageTextParams, 'text'> & {
  disable_web_page_preview?: boolean;
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
  private readonly requestLimit = new RateLimit2(30);

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

  sendMessage(chatId: number | string, text: string, options: MessageOptions = {}) {
    const {disable_web_page_preview: disablePreview, ...params} = options;
    if (disablePreview !== undefined && params.link_preview_options === undefined) {
      params.link_preview_options = {is_disabled: disablePreview};
    }
    return this.requestLimit.run(() =>
      this.call(() => this.bot.api.sendMessage({chat_id: chatId, text, ...params})),
    );
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
    return this.requestLimit.run(() => this.sendPhoto(chatId, photo, options, fileOptions));
  }

  editMessageText(text: string, options: EditMessageTextOptions) {
    const {disable_web_page_preview: disablePreview, ...params} = options;
    if (disablePreview !== undefined && params.link_preview_options === undefined) {
      params.link_preview_options = {is_disabled: disablePreview};
    }
    return this.call(() => this.bot.api.editMessageText({text, ...params}));
  }

  editMessageCaption(caption: string, options: Omit<EditMessageCaptionParams, 'caption'>) {
    return this.call(() => this.bot.api.editMessageCaption({caption, ...options}));
  }

  editMessageReplyMarkup(
    replyMarkup: InlineKeyboardMarkup,
    options: Omit<EditMessageReplyMarkupParams, 'reply_markup'>,
  ) {
    return this.call(() =>
      this.bot.api.editMessageReplyMarkup({reply_markup: replyMarkup, ...options}),
    );
  }

  deleteMessage(chatId: number | string, messageId: number): Promise<DeleteMessageResult> {
    return this.call(() => this.bot.api.deleteMessage({chat_id: chatId, message_id: messageId}));
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
