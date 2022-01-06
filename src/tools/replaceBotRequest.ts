import fetchRequest, {FetchRequestOptions} from "./fetchRequest";
import qs from "querystring";
import FormData from "form-data";
import {Stream} from "stream";
import * as Buffer from "buffer";
import {Module} from "module";

const {BaseError, FatalError, ParseError, TelegramError} = require('node-telegram-bot-api/src/errors');

const debug = require('debug')('app:replaceBotRequest');

(Module as any)._resolveFilename = ((origFn) => {
  return (...args: any[]) => {
    const path: string = args[0];
    if (['request', 'request-promise'].includes(path)) {
      args[0] = 'debug';
    }
    return origFn.apply(Module, args);
  };
})((Module as any)._resolveFilename);

interface RequestOptions {
  qs?: Record<string, any>,
  form?: string | Record<string, any>,
  formData: Record<string, {
    value: Stream | Buffer,
    options: {
      filename: string,
      contentType: string,
    },
  }>,
}

interface Bot {
  token?: string,
  _request: (path: string, options: RequestOptions) => Promise<unknown>,
  options: any,
  _fixReplyMarkup(obj: any): void;
  _buildURL: (path: string) => string;
}

function replaceBotRequest(botProto: Bot) {
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
    }
    if (reqOptions.qs) {
      self._fixReplyMarkup(reqOptions.qs);
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
      if (typeof reqOptions.form === "string") {
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

    return fetchRequest<string>(url, fetchOptions).then((resp) => {
      let data;
      try {
        data = resp.body = JSON.parse(resp.body);
      } catch (err) {
        throw new ParseError(`Error parsing response: ${resp.body}`, resp);
      }

      // debug('response %j', data);

      if (data.ok) {
        return data.result;
      }

      throw new TelegramError(`${data.error_code} ${data.description}`, resp);
    }).catch(error => {
      // TODO: why can't we do `error instanceof errors.BaseError`?
      if (error.response) throw error;
      throw new FatalError(error);
    });
  };
}

export default replaceBotRequest;