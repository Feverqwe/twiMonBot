import http from 'node:http';
import https from 'node:https';
import qs from 'node:querystring';
import FormData from 'form-data';

import {getDebug} from './getDebug';
import {CookieJar} from 'tough-cookie';
import axios, {AxiosError, AxiosResponse} from 'axios';
import http2 from 'http2-wrapper';
import { createHTTP2Adapter } from 'axios-http2-adapter';

const debug = getDebug('app:fetchRequest');

export interface FetchRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  responseType?: 'text' | 'json' | 'buffer' | 'stream';
  headers?: Record<string, string>;
  searchParams?: Record<string, any>;
  timeout?: number;
  keepAlive?: boolean;
  body?: string | URLSearchParams | FormData;
  cookieJar?: CookieJar;
  throwHttpErrors?: boolean;
  http2?: boolean;
}

interface FetchResponse<T = any> {
  ok: boolean;
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  rawBody: any;
  body: T;
  headers: Record<string, string | string[]>;
}

const http2axiosInstance = axios.create({
  adapter: createHTTP2Adapter({
    agent: new http2.Agent(),
    force: true,
  }),
});

const axiosKeepAliveInstance = axios.create({
  httpAgent: new http.Agent({
    keepAlive: true,
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
  }),
});

const axiosDefaultInstance = axios.create();

async function fetchRequest<T = any>(url: string, options?: FetchRequestOptions) {
  const {
    http2,
    responseType,
    keepAlive,
    searchParams,
    cookieJar,
    throwHttpErrors = true,
    timeout = 60 * 1000,
    ...fetchOptions
  } = options || {};

  let timeoutId: NodeJS.Timeout | null = null;

  try {
    fetchOptions.method = fetchOptions.method || 'GET';

    if (searchParams) {
      const uri = new URL(url);
      uri.search = '?' + qs.stringify(searchParams);
      url = uri.toString();
    }

    let axiosInstance = axiosDefaultInstance;
    if (http2) {
      axiosInstance = http2axiosInstance;
    } else
    if (keepAlive) {
      axiosInstance = axiosKeepAliveInstance;
    }

    if (cookieJar) {
      const cookieString = await cookieJar.getCookieString(url);
      if (cookieString) {
        if (!fetchOptions.headers) {
          fetchOptions.headers = {};
        }
        fetchOptions.headers.cookie = cookieString;
      }
    }

    let isTimeout = false;
    const controller = new AbortController();
    if (timeout) {
      timeoutId = setTimeout(() => {
        isTimeout = true;
        controller.abort();
      }, timeout);
    }

    const axiosResponseType = responseType === 'buffer' ? 'arraybuffer' : responseType;

    const rawResponse: AxiosResponse = await axiosInstance(url, {
      method: fetchOptions.method,
      data: fetchOptions.body,
      headers: fetchOptions.headers,
      responseType: axiosResponseType,
      signal: controller.signal,
      validateStatus: null,
    }).catch((err: Error & any) => {
      if (err.name === 'AbortError' && err.type === 'aborted' && isTimeout) {
        throw new TimeoutError(err);
      } else {
        throw new RequestError(err.message, err);
      }
    });

    const ok = rawResponse.status >= 200 && rawResponse.status < 300;

    const fetchResponse: FetchResponse<T> = {
      ok: ok,
      url: rawResponse.config.url ?? url,
      method: rawResponse.config.method ?? fetchOptions.method,
      statusCode: rawResponse.status,
      statusMessage: rawResponse.statusText,
      headers: normalizeHeaders(rawResponse.headers),
      rawBody: undefined as any,
      body: undefined as any,
    };

    if (cookieJar) {
      let rawCookies = fetchResponse.headers['set-cookie'];
      if (rawCookies) {
        if (!Array.isArray(rawCookies)) {
          rawCookies = [rawCookies];
        }
        await Promise.all(
          rawCookies.map((rawCookie: string) => {
            return cookieJar.setCookie(rawCookie, fetchResponse.url);
          }),
        );
      }
    }

    if (responseType === 'buffer') {
      fetchResponse.rawBody = Buffer.from(rawResponse.data as ArrayBuffer);
      fetchResponse.body = fetchResponse.rawBody;
    } else {
      fetchResponse.rawBody = rawResponse.data;
      fetchResponse.body = fetchResponse.rawBody;
    }

    if (throwHttpErrors && !ok) {
      if (responseType === 'stream') {
        fetchResponse.rawBody.destroy();
      }
      throw new HTTPError(fetchResponse);
    }

    return fetchResponse;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class RequestError extends Error {
  code?: string;
  stack!: string;
  declare readonly response?: FetchResponse;

  constructor(
    message: string,
    error: AxiosError | {},
    response?: FetchResponse | undefined,
  ) {
    super(message);

    this.name = 'RequestError';
    if ('code' in error) {
      this.code = error.code;
    }

    if (response) {
      Object.defineProperty(this, 'response', {
        enumerable: false,
        value: response,
      });
    }

    if (this.constructor === RequestError) {
      Error.captureStackTrace(this, this.constructor);

      if ('name' in error) {
        transformStack(this, error);
      }
    }
  }
}

export class HTTPError extends RequestError {
  declare readonly response: FetchResponse;

  constructor(response: FetchResponse) {
    super(`Response code ${response.statusCode} (${response.statusMessage!})`, {}, response);

    this.name = 'HTTPError';

    Error.captureStackTrace(this, this.constructor);
  }
}

export class TimeoutError extends RequestError {
  declare readonly response: undefined;

  constructor(error: Error) {
    super(error.message, error, undefined);
    this.name = 'TimeoutError';

    Error.captureStackTrace(this, this.constructor);

    transformStack(this, error);
  }
}

export class ReadError extends RequestError {
  declare readonly response: FetchResponse;

  constructor(error: Error, response: FetchResponse) {
    super(error.message, error, response);
    this.name = 'ReadError';

    Error.captureStackTrace(this, this.constructor);

    transformStack(this, error);
  }
}

function transformStack(err: Error & {stack: string}, origError: Error) {
  if (typeof origError.stack !== 'undefined') {
    const indexOfMessage = err.stack.indexOf(err.message) + err.message.length;
    const thisStackTrace = err.stack.slice(indexOfMessage).split('\n').reverse();
    const errorStackTrace = origError.stack
      .slice(origError.stack.indexOf(origError.message!) + origError.message!.length)
      .split('\n')
      .reverse();

    // Remove duplicated traces
    while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
      thisStackTrace.shift();
    }

    err.stack = `${err.stack.slice(0, indexOfMessage)}${thisStackTrace
      .reverse()
      .join('\n')}${errorStackTrace.reverse().join('\n')}`;
  }
}

function normalizeHeaders(fetchHeaders: AxiosResponse['headers']) {
  const headers: Record<string, string | string[]> = {};
  Object.entries(fetchHeaders).forEach(([key, values]) => {
    const lowKey = key.toLowerCase();
    if (Array.isArray(values)) {
      if (values.length === 1) {
        headers[lowKey] = values[0];
      } else if (values.length) {
        headers[lowKey] = values;
      }
    } else {
      headers[lowKey] = values;
    }
  });
  return headers;
}

export default fetchRequest;
