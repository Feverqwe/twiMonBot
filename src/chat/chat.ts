import Router from '../shared/router';
import QuickLRU from 'quick-lru';
import Main from '../main';
import {getDebug} from '../shared/tools/getDebug';
import registerAdminRoutes from './admin';
import registerBaseRoutes from './base';
import registerMenuRoutes from './menu';
import registerUserRoutes from './user';
import retryLoop from '../shared/tools/retryLoop';

const debug = getDebug('app:Chat');

class Chat {
  private readonly chatIdAdminIdsCache = new QuickLRU<number, number[]>({
    maxSize: 100,
    maxAge: 5 * 60 * 1000,
  });
  private readonly router: Router;
  private pollingPromise?: Promise<void>;
  private pollingController?: AbortController;

  constructor(private main: Main) {
    this.router = new Router();
    this.main.bot.on('message', (ctx) => {
      if (ctx.message) this.router.handle('message', ctx.message);
    });
    this.main.bot.on('callback_query', (ctx) => {
      if (ctx.callbackQuery) this.router.handle('callback_query', ctx.callbackQuery);
    });

    registerBaseRoutes(this.main, this.router, this.main.logs.chat, this.chatIdAdminIdsCache);
    registerMenuRoutes(this.main, this.router);
    registerUserRoutes(this.main, this.router, this.main.logs.chat);
    registerAdminRoutes(this.main, this.router);
  }

  async init() {
    const {bot} = this.main;

    const {username} = await bot.api.getMe();
    if (!username) throw new Error('Bot name is empty');

    this.router.init(username);

    this.pollingController = new AbortController();
    this.pollingPromise = retryLoop(
      () =>
        bot.startPolling(undefined, {
          onError: (err) => debug('polling error, retrying: %o', err),
        }),
      this.pollingController.signal,
      {
        onRetry: (err, delayMs) => {
          debug('polling stopped, restarting in %d ms: %o', delayMs, err);
        },
      },
    );
    void this.pollingPromise.catch((err) => {
      debug('polling retry loop stopped: %o', err);
    });
  }

  async stop() {
    this.pollingController?.abort();
    this.main.bot.stop();
    await this.pollingPromise;
  }
}

export default Chat;
