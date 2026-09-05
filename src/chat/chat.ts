import Router from '../shared/router';
import LogFile from '../shared/logFile';
import TimeCache from '../shared/tools/timeCache';
import Main from '../main';
import {getDebug} from '../shared/tools/getDebug';
import registerAdminRoutes from './admin';
import registerBaseRoutes from './base';
import registerMenuRoutes from './menu';
import registerUserRoutes from './user';

const debug = getDebug('app:Chat');

class Chat {
  readonly log = new LogFile('chat');
  private readonly chatIdAdminIdsCache = new TimeCache<number, number[]>({
    maxSize: 100,
    ttl: 5 * 60 * 1000,
  });
  private readonly router: Router;
  private pollingPromise?: Promise<void>;

  constructor(private main: Main) {
    this.router = new Router();
    this.main.bot.on('message', (ctx) => {
      if (ctx.message) this.router.handle('message', ctx.message);
    });
    this.main.bot.on('callback_query', (ctx) => {
      if (ctx.callbackQuery) this.router.handle('callback_query', ctx.callbackQuery);
    });

    registerBaseRoutes(this.main, this.router, this.log, this.chatIdAdminIdsCache);
    registerMenuRoutes(this.main, this.router);
    registerUserRoutes(this.main, this.router, this.log);
    registerAdminRoutes(this.main, this.router);
  }

  async init() {
    const {bot} = this.main;

    const {username} = await bot.api.getMe();
    if (!username) throw new Error('Bot name is empty');

    this.router.init(username);

    this.pollingPromise = bot.startPolling(undefined, {
      onError: (err) => debug('polling error, retrying: %o', err),
    });
    void this.pollingPromise.catch((err) => {
      debug('polling stopped: %o', err);
    });
  }

  async stop() {
    this.main.bot.stop();
    await this.pollingPromise;
  }
}

export default Chat;
