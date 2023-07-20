import Db from "./db";
import Sender from "./sender";
import Chat from "./chat";
import Checker, {ServiceInterface} from "./checker";
import Goodgame from "./services/goodgame";
import Twitch from "./services/twitch";
import Youtube from "./services/youtube";
import YtPubSub from "./ytPubSub";
import Wasd from "./services/wasd";
import Events from "events";
import {appConfig} from "./appConfig";
import {getDebug} from "./tools/getDebug";
import {getTelegramBot, TelegramBotWrapped} from "./tools/telegramBotApi";

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
  bot: TelegramBotWrapped;
  chat: Chat;
  botName!: string;
  ytPubSub: YtPubSub;
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
    this.ytPubSub = new YtPubSub(this);

    this.bot = getTelegramBot(appConfig.token);
    this.chat = new Chat(this);
  }

  async init() {
    await this.db.init();
    await Promise.all([
      this.ytPubSub.init(),
      this.bot.getMe().then((user) => {
        if (!user.username) throw new Error('Bot name is empty');

        this.botName = user.username;
        return this.bot.startPolling();
      }),
    ]);
    this.checker.init();
    this.sender.init();
  }

  getServiceById(id: string) {
    return this.serviceIdService.get(id);
  }
}

const main = new Main();
main.init().then(() => {
  debug('ready');
}, (err: any) => {
  debug('init error', err);
  process.exit(1);
});

export default Main;
