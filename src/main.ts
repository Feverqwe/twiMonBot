import Db from './db';
import Sender from './sender';
import Chat from './chat';
import Checker, {ServiceInterface} from './checker';
import Goodgame from './services/goodgame';
import Twitch from './services/twitch';
import Youtube from './services/youtube';
import Events from 'events';
import {appConfig} from './appConfig';
import {getDebug} from './shared/tools/getDebug';
import {getTelegramBot} from './shared/tools/telegramBotApi';
import type {Bot} from 'node-telegram-bot-api';
import express from 'express';
import WebServer from './shared/webServer';
import Vkplay from './services/vkplay';
import Kick from './services/kick';
import YtPubSub from './ytPubSub';
import AppLogs from './shared/appLogs';
import requireDatabaseReady from './shared/requireDatabaseReady';

const debug = getDebug('app:Main');

class Main extends Events {
  readonly logs = new AppLogs();
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
  ytPubSub: YtPubSub;
  bot: Bot;
  chat: Chat;
  private runtimeStarted = false;
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
    this.webServer = new WebServer(appConfig.webServer);
    this.ytPubSub = new YtPubSub(this);

    this.bot = getTelegramBot(appConfig.token, appConfig.telegramProxyUrl);
    this.chat = new Chat(this);
  }

  async init() {
    this.registerWebRoutes();
    await this.webServer.init();
    await this.db.health.start();
    await this.db.init();
    await this.chat.init();
    this.ytPubSub.init();
    this.checker.init();
    this.sender.init();
    this.runtimeStarted = true;
  }

  get isReady() {
    return this.runtimeStarted && this.db.health.isAvailable;
  }

  private registerWebRoutes() {
    this.webServer.app.use(requireDatabaseReady(() => this.isReady));
    this.ytPubSub.bind(this.webServer.app);
    this.webServer.app.post('/isLive', express.json(), async (req, res) => {
      const ids = req.body;
      const streams = (await this.db.getStreamsByChannelIds(ids)).filter(
        (stream) => !stream.isOffline,
      );
      res.json({streams});
    });
  }

  stop() {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce() {
    this.runtimeStarted = false;
    const healthStopped = this.db.health.stop();
    this.ytPubSub.stop();
    this.checker.stop();
    this.sender.stop();
    await Promise.all([healthStopped, this.webServer.close(), this.chat.stop()]);
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
