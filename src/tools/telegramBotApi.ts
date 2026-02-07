import fetchRequest, {FetchRequestOptions} from './fetchRequest';
import qs from 'node:querystring';
import FormData from 'form-data';
import {Stream} from 'node:stream';
import * as Buffer from 'node:buffer';
import RateLimit2 from './rateLimit2';
import TelegramBot from 'node-telegram-bot-api';
import {getDebug} from './getDebug';

Object.assign(process.env, {
  NTBA_FIX_319: true,
  NTBA_FIX_350: true,
});

interface TGError {
  new (message: string, resp: unknown): Error & {response: unknown};
}

const {FatalError, ParseError, TelegramError} = (
  TelegramBot as unknown as {
    errors: {
      FatalError: typeof Error;
      ParseError: TGError;
      TelegramError: TGError;
    };
  }
).errors;

const debug = getDebug('app:replaceBotRequest');

interface RequestOptions {
  qs?: Record<string, any>;
  form?: string | Record<string, any>;
  formData: Record<
    string,
    {
      value: Stream | Buffer;
      options: {
        filename: string;
        contentType: string;
      };
    }
  >;
}

interface Bot {
  token?: string;
  _request: (path: string, options: RequestOptions) => Promise<unknown>;
  options: any;

  _fixReplyMarkup(obj: any): void;

  _fixEntitiesField(obj: any): void;

  _fixReplyParameters(obj: any): void;

  _fixMessageIds(obj: any): void;

  _buildURL: (path: string) => string;
}

function telegramBotApi(botProto: Bot) {
  botProto._request = function (_path: string, reqOptions: RequestOptions) {
    const self = this;

    if (!self.token) {
      return Promise.reject(new FatalError('Telegram Bot Token not provided!'));
    }

    if (self.options.request) {
      Object.assign(reqOptions, self.options.request);
    }

    if (reqOptions.form) {
      self._fixReplyMarkup(reqOptions.form);
      self._fixEntitiesField(reqOptions.form);
      self._fixReplyParameters(reqOptions.form);
      self._fixMessageIds(reqOptions.form);
    }
    if (reqOptions.qs) {
      self._fixReplyMarkup(reqOptions.qs);
      this._fixReplyParameters(reqOptions.qs);
    }

    // debug('HTTP request: %j', reqOptions);

    let url = self._buildURL(_path);
    if (reqOptions.qs) {
      url += '?' + qs.stringify(reqOptions.qs);
    }

    const fetchOptions: FetchRequestOptions = {
      method: 'POST',
      keepAlive: true,
      responseType: 'text',
      throwHttpErrors: false,
    };

    if (reqOptions.form) {
      fetchOptions.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (typeof reqOptions.form === 'string') {
        fetchOptions.body = reqOptions.form;
      } else {
        fetchOptions.body = qs.stringify(reqOptions.form);
      }
    }

    if (reqOptions.formData) {
      const fd = new FormData();
      Object.entries(reqOptions.formData).forEach(([key, {value, options}]) => {
        fd.append(key, value, options);
      });
      fetchOptions.body = fd;
    }

    return fetchRequest<string>(url, fetchOptions)
      .then((resp) => {
        let data;
        try {
          data = resp.body = JSON.parse(resp.body);
        } catch (err) {
          const error = new ParseError(`Error parsing response: ${resp.body}`, resp);
          hideResponse(error);
          throw error;
        }

        // debug('response %j', data);

        if (data.ok) {
          return data.result;
        }

        const err = new TelegramError(`${data.error_code} ${data.description}`, resp);
        hideResponse(err);
        throw err;
      })
      .catch((error) => {
        if (error.response) throw error;
        throw new FatalError(error);
      });
  };
}

function hideResponse(err: Error & {response: any}) {
  const response = err.response;
  delete err.response;
  Object.defineProperty(err, 'response', {
    enumerable: false,
    value: response,
  });
}

telegramBotApi(TelegramBot.prototype as unknown as Bot);

export type TelegramBotWrapped = TelegramBot & {sendPhotoQuote: TelegramBot['sendPhoto']};

export const getTelegramBot = (token: string) => {
  const bot = new TelegramBot(token, {
    polling: {
      autoStart: false,
    },
  });

  bot.on('polling_error', function (err: any) {
    debug('pollingError %s', err.message);
  });

  const limit = new RateLimit2(30);
  const chatActionLimit = new RateLimit2(30);

  Object.assign(bot, {
    sendMessage: limit.wrap(bot.sendMessage.bind(bot)),
    sendPhotoQuote: limit.wrap(bot.sendPhoto.bind(bot)),
    sendChatAction: chatActionLimit.wrap(bot.sendChatAction.bind(bot)),
  });

  return bot as TelegramBotWrapped;
};
