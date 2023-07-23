import Db from './db';
import Sender from './sender';
import Chat from './chat';
import Checker, {ServiceInterface} from './checker';
import Goodgame from './services/goodgame';
import Twitch from './services/twitch';
import Youtube from './services/youtube';
import Wasd from './services/wasd';
import Events from 'events';
import {appConfig} from './appConfig';
import {getDebug} from './tools/getDebug';
import {getTelegramBot, TelegramBotWrapped} from './tools/telegramBotApi';
import WebServer from "./webServer";

const debug = getDebug('app:Main');

process.on('unhandledRejection', (err: Error & {code?: string}, promise) => {
  debug('unhandledRejection %o', err);
  if (err.code === 'EFATAL') {
    process.exit(1);
  }
});

class Main extends Events {
  db: Db;
  twitch: Twitch;
  youtube: Youtube;
  goodgame: Goodgame;
  wasd: Wasd;
  services: ServiceInterface[];
  serviceIdService: Map<string, ServiceInterface>;
  sender: Sender;
  checker: Checker;
  webServer: WebServer;
  bot: TelegramBotWrapped;
  chat: Chat;
  constructor() {
    super();

    this.db = new Db(this);

    this.twitch = new Twitch(this);
    this.youtube = new Youtube(this);
    this.goodgame = new Goodgame(this);
    this.wasd = new Wasd(this);
    this.services = [this.twitch, this.youtube, this.goodgame, this.wasd];
    this.serviceIdService = this.services.reduce((map, service) => {
      map.set(service.id, service);
      return map;
    }, new Map());

    this.sender = new Sender(this);
    this.checker = new Checker(this);
    this.webServer = new WebServer(this);

    this.bot = getTelegramBot(appConfig.token);
    this.chat = new Chat(this);
  }

  async init() {
    await this.db.init();
    await Promise.all([
      this.webServer.init(),
      this.chat.init(),
    ]);
    this.checker.init();
    this.sender.init();
  }

  getServiceById(id: string) {
    return this.serviceIdService.get(id);
  }
}

const main = new Main();
main.init().then(
  () => {
    debug('ready');
  },
  (err: any) => {
    debug('init error', err);
    process.exit(1);
  },
);

export default Main;
