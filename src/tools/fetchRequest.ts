import promiseTry from "./promiseTry";
import http from "http";
import https from "https";
import qs from "querystring";
import AbortController from "abort-controller";
import FormData from "form-data";

const fetch = require('node-fetch');

const debug = require('debug')('app:fetchRequest');

export interface FetchRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  responseType?: 'text' | 'json' | 'buffer' | 'stream',
  headers?: Record<string, string | string[] | undefined>,
  searchParams?: Record<string, any>,
  timeout?: number,
  keepAlive?: boolean,
  body?: string | URLSearchParams | FormData,
  cookieJar?: {
    setCookie: (rawCookie: string, url: string) => Promise<unknown>,
    getCookieString: (url: string) => Promise<string>,
  },
  throwHttpErrors?: boolean,
}

interface FetchResponse<T = any> {
  ok: boolean,
  url: string,
  method: string,
  statusCode: number,
  statusMessage: string,
  rawBody: any,
  body: T,
  headers: Record<string, string | string[]>,
}

function fetchRequest<T = any>(url: string, options?: FetchRequestOptions) {
  const {responseType, keepAlive, searchParams, cookieJar, throwHttpErrors = true, timeout = 60 * 1000, ...fetchOptions} = options || {};

  let timeoutId: NodeJS.Timeout | null = null;
  let setCookiePromise: Promise<unknown[]> | null = null;

  return promiseTry(async () => {
    fetchOptions.method = fetchOptions.method || 'GET';

    if (searchParams) {
      const uri = new URL(url);
      uri.search = '?' + qs.stringify(searchParams);
      url = uri.toString();
    }

    let agentFn;
    if (keepAlive) {
      agentFn = keepAliveAgentFn;
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

    const rawResponse: Response & {buffer: () => Promise<Buffer>} = await fetch(url, {
      agent: agentFn,
      ...fetchOptions,
      signal: controller.signal,
    }).catch((err: Error & any) => {
      if (err.name === 'AbortError' && err.type === 'aborted' && isTimeout) {
        throw new TimeoutError(err);
      } else {
        throw new RequestError(err.message, err);
      }
    });

    const fetchResponse: FetchResponse<T> = {
      ok: rawResponse.ok,
      url: rawResponse.url,
      method: fetchOptions.method,
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
        setCookiePromise = Promise.all(rawCookies.map((rawCookie: string) => {
          return cookieJar.setCookie(rawCookie, fetchResponse.url)
        }));
      }
    }

    if (fetchOptions.method !== 'HEAD') {
      try {
        if (responseType === 'stream') {
          fetchResponse.rawBody = rawResponse.body;
        } else
        if (responseType === 'buffer') {
          fetchResponse.rawBody = await rawResponse.buffer();
        } else {
          fetchResponse.rawBody = await rawResponse.text();
        }
      } catch (err: Error & any) {
        if (err.name === 'AbortError' && err.type === 'aborted' && isTimeout) {
          throw new TimeoutError(err);
        } else {
          throw new ReadError(err, fetchResponse);
        }
      }

      if (responseType === 'json') {
        try {
          fetchResponse.body = JSON.parse(fetchResponse.rawBody);
        } catch (err) {
          if (rawResponse.ok) {
            throw err;
          }
        }
      } else {
        fetchResponse.body = fetchResponse.rawBody;
      }
    }

    if (throwHttpErrors && !rawResponse.ok) {
      if (responseType === 'stream') {
        fetchResponse.rawBody.destroy();
      }
      throw new HTTPError(fetchResponse);
    }

    return fetchResponse;
  }).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return setCookiePromise;
  });
}

export class RequestError extends Error {
  code?: string;
  stack!: string;
  declare readonly response?: FetchResponse;

  constructor(message: string, error: {} | Error & {code?: string}, response?: FetchResponse | undefined) {
    super(message);

    this.name = 'RequestError';
    if ('code' in error) {
      this.code = error.code;
    }

    if (response) {
      Object.defineProperty(this, 'response', {
        enumerable: false,
        value: response
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
  if (typeof origError.stack !== "undefined") {
    const indexOfMessage = err.stack.indexOf(err.message) + err.message.length;
    const thisStackTrace = err.stack.slice(indexOfMessage).split('\n').reverse();
    const errorStackTrace = origError.stack.slice(origError.stack.indexOf(origError.message!) + origError.message!.length).split('\n').reverse();

    // Remove duplicated traces
    while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
      thisStackTrace.shift();
    }

    err.stack = `${err.stack.slice(0, indexOfMessage)}${thisStackTrace.reverse().join('\n')}${errorStackTrace.reverse().join('\n')}`;
  }
}


const httpAgent = new http.Agent({
  keepAlive: true
});

const httpsAgent = new https.Agent({
  keepAlive: true
});

function keepAliveAgentFn(_parsedURL: URL) {
  if (_parsedURL.protocol === 'http:') {
    return httpAgent;
  } else {
    return httpsAgent;
  }
}

function normalizeHeaders(fetchHeaders: Headers & any) {
  const headers: Record<string, string | string[]> = {};
  const rawHeaders: Record<string, string[]> = fetchHeaders.raw();
  Object.entries(rawHeaders).forEach(([key, values]) => {
    const lowKey = key.toLowerCase();
    if (values.length === 1) {
      headers[lowKey] = values[0];
    } else
    if (values.length) {
      headers[lowKey] = values;
    }
  });
  return headers;
}

export default fetchRequest;
