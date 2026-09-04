import {
  Bot,
  RateLimiter,
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

export const sendRateLimitedTelegramPhoto = async (api: Bot['api'], params: SendPhotoParams) => {
  await messageRateLimiter.acquire(params.chat_id);
  return api.sendPhoto(params);
};

/** Temporarily bridges legacy event callbacks and non-blocking polling startup. */
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
}

export const getTelegramBot = (token: string) => new TelegramBotWrapped(token);
