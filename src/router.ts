import ErrorWithCode from "./tools/errorWithCode";
import Main from "./main";
import qs from "querystring";

const debug = require('debug')('app:router');

type MessageTypesArr = typeof messageTypes;
type MessageTypes = MessageTypesArr[number];
type MessageTypesObj = {
  [k in MessageTypes]: RouterMethod;
};

const messageTypes = [
  'text', 'audio', 'document', 'photo', 'sticker', 'video', 'voice', 'contact',
  'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
  'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
] as const;

type RouterMethodCallback<I = RouterReq, O = RouterRes> = (req: I, res: O, next: () => void) => void;

export type RouterMethodArgs<I = RouterReq, O = RouterRes> = [RegExp, ...RouterMethodCallback<I, O>[]] | RouterMethodCallback<I, O>[];
interface RouterMethod<I = RouterReq, O = RouterRes> {
  (...callbacks: RouterMethodArgs<I, O>): void
}

interface WaitResponseDetails extends RouterRouteDetails {
  throwOnCommand?: boolean
}

interface RouterRouteDetails {
  event?: ['message', 'callback_query'][number],
  type?: string,
  fromId?: number | null,
  chatId?: number,
}

export interface RouterTextReq extends RouterMessageReq {
  message: TMessage & {text: string};
  fromId: number | null;
}

export interface RouterMessageReq extends RouterReqWithAnyMessage {
  message: TMessage;
  callback_query: undefined;
  params: {[s: string]: string};
}

export interface RouterCallbackQueryReq extends RouterReqWithAnyMessage {
  message: undefined;
  callback_query: TCallbackQuery & {data: string};
  fromId: number;
}

export interface RouterReqWithAnyMessage extends RouterReqCallback {
  messageId: number;
  chatId: number;
  chatType: string;
}

interface RouterReqCallback extends RouterReq {
  params: {[s: string]: string};
  query: {[s: string]: any};
}

const RouterImpl = class MessageTypesImpl implements MessageTypesObj {
  declare audio: RouterMethod;
  declare contact: RouterMethod;
  declare delete_chat_photo: RouterMethod;
  declare document: RouterMethod;
  declare group_chat_created: RouterMethod;
  declare left_chat_participant: RouterMethod;
  declare location: RouterMethod;
  declare new_chat_participant: RouterMethod;
  declare new_chat_photo: RouterMethod;
  declare new_chat_title: RouterMethod;
  declare photo: RouterMethod;
  declare sticker: RouterMethod;
  declare text: RouterMethod<RouterTextReq>;
  declare video: RouterMethod;
  declare voice: RouterMethod;

  stack: RouterRoute[] = [];
  constructor() {
    for (const type of messageTypes) {
      this[type] = (...callbacks: RouterMethodArgs<any>) => {
        const {re, callbackList} = prepareArgs(callbacks);

        callbackList.forEach((callback) => {
          this.stack.push(new RouterRoute({
            event: 'message',
            type: type
          }, re, callback));
        });
      };
    }
  }
}

class Router extends RouterImpl {
  _botNameRe: RegExp | null = null;

  textOrCallbackQuery = this.custom<RouterTextReq | RouterCallbackQueryReq>(['text', 'callback_query']);

  constructor(public main: Main) {
    super();
  }

  get botNameRe() {
    if (!this._botNameRe) {
      this._botNameRe = new RegExp('^' + this.main.botName + '$', 'i');
    }
    return this._botNameRe;
  }

  handle = (event: 'message' | 'callback_query', data: TMessage|TCallbackQuery) => {
    const commands = getCommands(event, data, this.botNameRe);
    if (!commands.length) {
      commands.push('');
    }
    commands.forEach((command) => {
      const req = new RouterReq(event, data);
      const res = new RouterRes(this.main.bot, req);
      let index = 0;
      const next = (): void => {
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

  all(...callbacks: RouterMethodArgs) {
    const {re, callbackList} = prepareArgs(callbacks);

    callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({}, re, callback));
    });
  }

  message(...callbacks: RouterMethodArgs<RouterMessageReq>) {
    const {re, callbackList} = prepareArgs(callbacks);

    callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'message'
      }, re, callback));
    });
  }

  callback_query(...callbacks: RouterMethodArgs<RouterCallbackQueryReq, RouterRes>) {
    const {re, callbackList} = prepareArgs(callbacks);

    callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'callback_query'
      }, re, callback));
    });
  }

  custom<I = RouterReq, O = RouterRes>(methods: (keyof Router)[]) {
    return <I2 = I, O2 = O>(...callbacks: RouterMethodArgs<I2, O2>) => {
      methods.forEach((method) => {
        (this[method] as RouterMethod<any, any>).apply(this, callbacks);
      });
    };
  }

  waitResponse<I = RouterReq, O = RouterRes>(re: RegExp|null, details: WaitResponseDetails, timeoutSec: number): Promise<{
    req: I, res: O, next: () => void
  }> {
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        callback(new ErrorWithCode('ETIMEDOUT', 'RESPONSE_TIMEOUT'));
      }, timeoutSec * 1000);

      const callback = (err: null | Error & any, result?: any) => {
        const pos = this.stack.indexOf(route);
        if (pos !== -1) {
          this.stack.splice(pos, 1);
        }

        clearTimeout(timeoutTimer);

        err ? reject(err) : resolve(result);
      };

      const route = new RouterRoute(details, re, (req, res, next) => {
        if (details.throwOnCommand) {
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
  event?: ['message', 'callback_query'][number];
  type?: keyof (TMessage | TCallbackQuery);
  fromId?: number | null;
  chatId?: number;
  constructor(details: RouterRouteDetails, re: RegExp | null, callback: RouterMethodCallback) {
    this.re = re;
    this.event = details.event;
    this.type = details.type as (keyof (TMessage | TCallbackQuery) | undefined);
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
    if (this.event && !req[this.event]) {
      return false;
    }
    if (this.type && !req[this.event!]![this.type]) {
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
  commands = [] as string[];
  command = '';
  params: {[s: string]: string} | null = null;
  message?: TMessage;
  callback_query?: TCallbackQuery;
  private _cache = {} as {[s: string]: {value?: any}};

  constructor(public event: 'message' | 'callback_query', data: TMessage|TCallbackQuery) {
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
  }

  get fromId(): number | null {
    return this._useCache('fromId', () => {
      let from = null;
      if (this.message) {
        from = this.message.from || null;
      } else
      if (this.callback_query) {
        from = this.callback_query.from;
      }
      return from && from.id;
    });
  }

  get chatId(): number | null {
    return this._useCache('chatId', () => {
      const message = this._findMessage();
      return message && message.chat.id;
    });
  }

  get chatType(): string | null {
    return this._useCache('chatType', () => {
      const message = this._findMessage();
      return message && message.chat.type;
    });
  }

  get messageId(): number | null {
    return this._useCache('messageId', () => {
      const message = this._findMessage();
      return message && message.message_id;
    });
  }

  get query() {
    return this._useCache('query', () => {
      let query: {[s: string]: any} = {};

      if (this.callback_query) {
        const text = this.callback_query.data;
        const re = /\?([^\s]+)/;
        const m = re.exec(text as string);
        if (m) {
          const queryStr = m[1];
          if (/^[\[{]/.test(queryStr)) {
            query = JSON.parse(queryStr);
          } else {
            query = qs.parse(m[1]);
          }
        }
      }

      return Object.freeze(query);
    });
  }

  get entities() {
    return this._useCache('entities', () => {
      const entities: Record<string, {type: string, value: string, url?: string, user?: TUser}[]> = {};

      if (this.message && this.message.entities) {
        const text = this.message.text || '';
        this.message.entities.forEach((entity) => {
          let array = entities[entity.type];
          if (!array) {
            array = entities[entity.type] = [];
          }
          array.push({
            type: entity.type,
            value: text.substring(entity.offset, entity.offset + entity.length),
            url: entity.url,
            user: entity.user
          });
        });
      }

      return Object.freeze(entities);
    });
  }

  private _findMessage() {
    let message = null;
    if (this.message) {
      message = this.message;
    } else
    if (this.callback_query) {
      message = this.callback_query.message;
    }
    return message || null;
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

function prepareArgs(callbacks: RouterMethodArgs<any, any>) {
  let re = null;
  if (typeof callbacks[0] !== 'function') {
    re = callbacks.shift() as RegExp;
  }
  return {
    re: re,
    callbackList: callbacks as RouterMethodCallback[]
  }
}

function getCommands(event: string, data: TMessage|TCallbackQuery, botNameRe: RegExp) {
  const commands: string[] = [];
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
            let command = text.substring(entity.offset, entity.offset + entity.length);
            const m = /([^@]+)(?:@(.+))?/.exec(command);
            if (m) {
              command = m[1];
              botName = m[2];
            }
            const start = entity.offset + entity.length;
            const args = text.substring(start, end);
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
      if (typeof callbackQuery.data === "string") {
        commands.push(callbackQuery.data);
      }
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
