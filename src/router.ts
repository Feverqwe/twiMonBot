import ErrorWithCode from "./tools/errorWithCode";
import Main from "./main";

const debug = require('debug')('app:router');
const qs = require('querystring');

const messageTypes = [
  'text', 'audio', 'document', 'photo', 'sticker', 'video', 'voice', 'contact',
  'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
  'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
];

interface RouterMethodCallback {
  (req: RouterReq|any, res: RouterRes|any, next: () => void): void
}

interface RouterMethod {
  (re: RegExp, ...callbacks: RouterMethodCallback[]): void
}

interface RouterRouteDetails {
  event?: string,
  type?: string,
  fromId?: number,
  chatId?: number,
}

interface WaitResponseDetails extends RouterRouteDetails {
  throwOnCommand?: boolean
}

class Router {
  main: Main;
  _botNameRe: RegExp;
  stack: RouterRoute[];

  text: RouterMethod;
  audio: RouterMethod;
  document: RouterMethod;
  photo: RouterMethod;
  sticker: RouterMethod;
  video: RouterMethod;
  voice: RouterMethod;
  contact: RouterMethod;
  location: RouterMethod;
  new_chat_participant: RouterMethod;
  left_chat_participant: RouterMethod;
  new_chat_title: RouterMethod;
  new_chat_photo: RouterMethod;
  delete_chat_photo: RouterMethod;
  group_chat_create: RouterMethod;

  textOrCallbackQuery?: RouterMethod;

  constructor(main: Main) {
    this.main = main;
    this._botNameRe = null;

    this.stack = [];

    messageTypes.forEach((type: string) => {
      // @ts-ignore
      this[type] = (re: RegExp, ...callbacks: RouterMethodCallback[]) => {
        const args = prepareArgs(re, ...callbacks);

        args.callbackList.forEach((callback) => {
          this.stack.push(new RouterRoute({
            event: 'message',
            type: type
          }, args.re, callback));
        });
      };
    });
  }

  get botNameRe() {
    if (!this._botNameRe) {
      this._botNameRe = new RegExp('^' + this.main.botName + '$', 'i');
    }
    return this._botNameRe;
  }

  handle = (event: string, data: TMessage|TCallbackQuery) => {
    const commands = getCommands(event, data, this.botNameRe);
    if (!commands.length) {
      commands.push('');
    }
    commands.forEach((command) => {
      const req = new RouterReq(event, data);
      const res = new RouterRes(this.main.bot, req);
      let index = 0;
      const next = () => {
        const route = this.stack[index++];
        if (!route) return;

        req.commands = commands;
        req.command = command;
        req.params = route.getParams(command);

        if (route.match(req)) {
          return route.dispatch(req, res, next);
        }

        next();
      };
      next();
    });
  };

  all(re?: RegExp|RouterMethodCallback, ...callbacks: RouterMethodCallback[]) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({}, args.re, callback));
    });
  }

  message(re?: RegExp|RouterMethodCallback, ...callbacks: RouterMethodCallback[]) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'message'
      }, args.re, callback));
    });
  }

  callback_query(re?: RegExp|RouterMethodCallback, ...callbacks: RouterMethodCallback[]) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'callback_query'
      }, args.re, callback));
    });
  }

  custom(methods: string[]): RouterMethod {
    return (re: RegExp|RouterMethodCallback, ...callbacks: RouterMethodCallback[]) => {
      const args = [re, ...callbacks];
      methods.forEach((method) => {
        // @ts-ignore
        this[method].apply(this, args);
      });
    };
  }

  waitResponse(re: RegExp|WaitResponseDetails, details: WaitResponseDetails|number, timeoutSec?: number): Promise<{
    req: RouterReq, res: RouterRes, next: () => void
  }> {
    if (!(re instanceof RegExp)) {
      timeoutSec = details as unknown as number;
      details = re as WaitResponseDetails;
      re = null;
    }
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        callback(new ErrorWithCode('ETIMEDOUT', 'RESPONSE_TIMEOUT'));
      }, timeoutSec * 1000);

      const callback = (err: any, result?: any) => {
        const pos = this.stack.indexOf(route);
        if (pos !== -1) {
          this.stack.splice(pos, 1);
        }

        clearTimeout(timeoutTimer);

        err ? reject(err) : resolve(result);
      };

      const route = new RouterRoute(details as WaitResponseDetails, re as RegExp|null, (req: RouterReq, res: RouterRes, next: () => void) => {
        if ((details as WaitResponseDetails).throwOnCommand) {
          const entities = req.entities;
          if (entities.bot_command) {
            callback(new ErrorWithCode('BOT_COMMAND', 'RESPONSE_COMMAND'));
            next();
          } else {
            callback(null, {req, res, next});
          }
        } else {
          callback(null, {req, res, next});
        }
      });

      this.stack.unshift(route);
    });
  }
}

class RouterRoute {
  re: RegExp|null;
  dispatch: RouterMethodCallback;
  event: string;
  type: string;
  fromId: number;
  chatId: number;
  constructor(details: RouterRouteDetails, re: RegExp, callback: RouterMethodCallback) {
    this.re = re;
    this.event = details.event;
    this.type = details.type;
    this.fromId = details.fromId;
    this.chatId = details.chatId;
    this.dispatch = (req, res, next) => {
      try {
        callback(req, res, next);
      } catch (err) {
        debug('Dispatch error %o', err);
      }
    };
  }

  getParams(command: string) {
    if (!this.re) {
      return {};
    }

    let result = null;
    if (this.re) {
      const m = this.re.exec(command);
      if (m) {
        result = m.groups || {};
      }
    }
    return result;
  }

  match(req: RouterReq) {
    if (!req.params) {
      return false;
    }
    // @ts-ignore
    if (this.event && !req[this.event]) {
      return false;
    }
    // @ts-ignore
    if (this.type && !req[this.event][this.type]) {
      return false;
    }
    if (this.chatId && req.chatId != this.chatId) {
      return false;
    }
    if (this.fromId && req.fromId != this.fromId) {
      return false;
    }
    return true;
  }
}

export class RouterReq {
  commands: string[];
  command: string;
  params: {[s: string]: string};
  event: string;
  private _cache: {[s: string]: {value?: any}};
  message?: TMessage;
  callback_query?: TCallbackQuery;

  constructor(event: string, data: TMessage|TCallbackQuery) {
    this.commands = null;
    this.command = null;
    this.params = null;
    this.event = event;
    switch (event) {
      case 'message': {
        this.message = data as TMessage;
        break;
      }
      case 'callback_query': {
        this.callback_query = data as TCallbackQuery;
        break;
      }
      default: {
        throw new Error(`Unknown case ${event}`);
      }
    }
    this._cache = {};
  }

  get fromId(): number {
    return this._useCache('fromId', () => {
      let from = null;
      if (this.message) {
        from = this.message.from;
      } else
      if (this.callback_query) {
        from = this.callback_query.from;
      }
      return from && from.id;
    });
  }

  get chatId(): number {
    return this._useCache('chatId', () => {
      const message = this._findMessage();
      return message && message.chat.id;
    });
  }

  get chatType(): string {
    return this._useCache('chatType', () => {
      const message = this._findMessage();
      return message && message.chat.type;
    });
  }

  get messageId(): number {
    return this._useCache('messageId', () => {
      const message = this._findMessage();
      return message && message.message_id;
    });
  }

  get query() {
    return this._useCache('query', () => {
      let query: {[s: string]: any} = {};
      if (!this.callback_query) return Object.freeze(query);

      const text = this.callback_query.data;
      const re = /\?([^\s]+)/;
      const m = re.exec(text);
      if (m) {
        const queryStr = m[1];
        if (/^[\[{]/.test(queryStr)) {
          query = JSON.parse(queryStr);
        } else {
          query = qs.parse(m[1]);
        }
      }
      return Object.freeze(query);
    });
  }

  get entities() {
    return this._useCache('entities', () => {
      const entities: {[s: string]: any} = {};
      if (!this.message || !this.message.entities) return Object.freeze(entities);

      this.message.entities.forEach((entity) => {
        let array = entities[entity.type];
        if (!array) {
          array = entities[entity.type] = [];
        }
        array.push({
          type: entity.type,
          value: this.message.text.substr(entity.offset, entity.length),
          url: entity.url,
          user: entity.user
        });
      });
      return Object.freeze(entities);
    });
  }

  private _findMessage(): TMessage {
    let message = null;
    if (this.message) {
      message = this.message;
    } else
    if (this.callback_query) {
      message = this.callback_query.message;
    }
    return message;
  }

  private _useCache<T>(key: string, fn: () => T):T {
    let cache = this._cache[key];
    if (!cache) {
      cache = this._cache[key] = {};
      cache.value = fn();
    }
    return cache.value;
  }
}

export class RouterRes {
  bot: any;
  req: RouterReq;
  constructor(bot: any, req: RouterReq) {
    this.bot = bot;
    this.req = req;
  }
}

function prepareArgs(re?: RegExp|RouterMethodCallback, ...callbacks: RouterMethodCallback[]) {
  if (typeof re === 'function') {
    callbacks.unshift(re);
    re = null;
  }
  return {
    re: re as RegExp|null,
    callbackList: callbacks
  }
}

function getCommands(event: string, data: TMessage|TCallbackQuery, botNameRe: RegExp): string[] {
  const commands = [];
  switch (event) {
    case 'message': {
      const message = data as TMessage;
      if (message.text && message.entities) {
        const text = message.text;
        const entities = message.entities.slice(0).reverse();
        let end = text.length;
        entities.forEach((entity) => {
          if (entity.type === 'bot_command') {
            let botName = null;
            let command = text.substr(entity.offset, entity.length);
            const m = /([^@]+)(?:@(.+))?/.exec(command);
            if (m) {
              command = m[1];
              botName = m[2];
            }
            const start = entity.offset + entity.length;
            const args = text.substr(start, end - start);
            if (args) {
              command += args;
            }
            if (!botName || botNameRe.test(botName)) {
              commands.unshift(command);
            }
            end = entity.offset;
          }
        });
      }
      break;
    }
    case 'callback_query': {
      const callbackQuery = data as TCallbackQuery;
      commands.push(callbackQuery.data);
      break;
    }
  }
  return commands;
}

export interface TUser {
  id: number,
  is_bot: boolean,
  first_name: string,
  last_name?: string,
  username?: string,
  language_code?: string
}

export interface TChat {
  id: number,
  type: string,
  title?: string,
  username?: string,
  first_name?: string,
  last_name?: string,
  all_members_are_administrators?: true,
  photo?: TChatPhoto,
  description?: string,
  invite_link?: string,
  pinned_message?: TMessage,
  sticker_set_name?: string,
  can_set_sticker_set?: boolean
}

export interface TMessage {
  message_id: number,
  from?: TUser // empty for messages sent to channels
  date: number,
  chat: TChat,
  forward_from?: TUser,
  forward_from_chat?: TChat,
  forward_from_message_id?: number,
  forward_signature?: string,
  forward_sender_name?: string,
  forward_date?: number,
  reply_to_message?: TMessage,
  edit_date?: number,
  media_group_id?: string,
  author_signature?: string,
  text?: string,
  entities?: TMessageEntity[],
  caption_entities?: TMessageEntity[],
  audio?: any,
  document?: any,
  animation?: any,
  game?: any,
  photo?: TPhotoSize[],
  sticker?: any,
  video?: any,
  voice?: any,
  video_note?: any,
  caption?: string,
  contact?: any,
  location?: any,
  venue?: any,
  poll?: any,
  new_chat_members?: TUser[],
  left_chat_member?: TUser,
  new_chat_title?: string,
  new_chat_photo?: TPhotoSize[],
  delete_chat_photo?: true,
  group_chat_created?: true,
  supergroup_chat_created?: true,
  channel_chat_created?: true,
  migrate_to_chat_id?: number,
  migrate_from_chat_id?: number,
  pinned_message?: TMessage,
  invoice?: any,
  successful_payment?: any,
  connected_website?: string,
  passport_data?: any,
  reply_markup?: TInlineKeyboardMarkup,
}

export interface TMessageEntity {
  type: string,
  offset: number,
  length: number,
  url?: string,
  user?: TUser
}

export interface TPhotoSize {
  file_id: string,
  width: number,
  height: number,
  file_size?: number
}

export interface TInlineKeyboardMarkup {
  inline_keyboard: TInlineKeyboardButton[][]
}

export interface TInlineKeyboardButton {
  text: string,
  url?: string,
  login_url?: any,
  callback_data?: string,
  switch_inline_query?: string,
  switch_inline_query_current_chat?: string,
  callback_game?: any,
  pay?: boolean,
}

export interface TCallbackQuery {
  id: string,
  from: TUser,
  message?: TMessage,
  inline_message_id?: string,
  chat_instance: string,
  data?: string,
  game_short_name?: string
}

export interface TChatPhoto {
  small_file_id: string,
  big_file_id: string
}

export interface TChatMember {
  user: TUser,
  status: string,
  until_date?: number,
  can_be_edited?: boolean,
  can_post_messages?: boolean,
  can_edit_messages?: boolean,
  can_delete_messages?: boolean,
  can_restrict_members?: boolean,
  can_promote_members?: boolean,
  can_change_info?: boolean,
  can_invite_users?: boolean,
  can_pin_messages?: boolean,
  is_member?: boolean,
  can_send_messages?: boolean,
  can_send_media_messages?: boolean,
  can_send_polls?: boolean,
  can_send_other_messages?: boolean,
  can_add_web_page_previews?: boolean,
}

export default Router;