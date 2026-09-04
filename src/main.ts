import Db from './db';
import Sender from './sender';
import Chat from './chat';
import Checker, {ServiceInterface} from './checker';
import Goodgame from './services/goodgame';
import Twitch from './services/twitch';
import Youtube from './services/youtube';
import Events from 'events';
import {appConfig} from './appConfig';
import {getDebug} from './tools/getDebug';
import {getTelegramBot} from './tools/telegramBotApi';
import type {Bot} from 'node-telegram-bot-api';
import WebServer from './webServer';
import Vkplay from './services/vkplay';
import Kick from './services/kick';

const debug = getDebug('app:Main');

class Main extends Events {
  db: Db;
  twitch: Twitch;
  youtube: Youtube;
  goodgame: Goodgame;
  vkplay: Vkplay;
  kick: Kick;
  services: ServiceInterface[];
  serviceIdService: Map<string, ServiceInterface>;
  sender: Sender;
  checker: Checker;
  webServer: WebServer;
  bot: Bot;
  chat: Chat;
  private stopPromise?: Promise<void>;
  constructor() {
    super();

    this.db = new Db(this);

    this.twitch = new Twitch(this);
    this.youtube = new Youtube(this);
    this.goodgame = new Goodgame(this);
    this.vkplay = new Vkplay(this);
    this.kick = new Kick(this);
    this.services = [this.twitch, this.youtube, this.goodgame, this.vkplay, this.kick];
    this.serviceIdService = this.services.reduce((map, service) => {
      map.set(service.id, service);
      return map;
    }, new Map());

    this.sender = new Sender(this);
    this.checker = new Checker(this);
    this.webServer = new WebServer(this);

    this.bot = getTelegramBot(appConfig.token, appConfig.telegramProxyUrl);
    this.chat = new Chat(this);
  }

  async init() {
    await this.db.init();
    await Promise.all([this.webServer.init(), this.chat.init()]);
    this.checker.init();
    this.sender.init();
  }

  stop() {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce() {
    this.checker.stop();
    this.sender.stop();
    await Promise.all([this.webServer.close(), this.chat.stop()]);
    await this.db.close();
  }

  getServiceById(id: string) {
    return this.serviceIdService.get(id);
  }
}

const main = new Main();

const shutdown = (exitCode: number) => {
  void main.stop().then(
    () => process.exit(exitCode),
    (err) => {
      debug('shutdown error %o', err);
      process.exit(1);
    },
  );
};

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (err: Error & {code?: string}) => {
  debug('unhandledRejection %o', err);
  if (err.code === 'EFATAL') shutdown(1);
});

main.init().then(
  () => {
    debug('ready');
  },
  (err: any) => {
    debug('init error', err);
    shutdown(1);
  },
);

export default Main;
