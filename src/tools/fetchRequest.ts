import promiseTry from "./promiseTry";

const debug = require('debug')('app:fetchRequest');
const http = require('http');
const https = require('https');
const fetch = require('node-fetch');
const qs = require('querystring');
const AbortController = require('abort-controller');

interface FetchRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  responseType?: 'text' | 'json' | 'buffer',
  headers?: Record<string, string | string[] | undefined>,
  searchParams?: Record<string, any>,
  timeout?: number,
  keepAlive?: boolean,
  body?: string | URLSearchParams,
  cookieJar?: {
    setCookie: (rawCookie: string, url: string) => Promise<unknown>,
    getCookieString: (url: string) => Promise<string>,
  },
}

interface FetchResponse {
  url: string,
  method: string,
  statusCode: number,
  statusMessage: string,
  rawBody: any,
  body: any,
  headers: Record<string, string | string[]>,
}

function fetchRequest(url: string, options?: FetchRequestOptions) {
  const {responseType, keepAlive, searchParams, cookieJar, timeout, ...fetchOptions} = options || {};

  let isTimeout = false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    isTimeout = true;
    controller.abort();
  }, timeout);

  return promiseTry(async () => {
    fetchOptions.method = fetchOptions.method || 'GET';

    if (searchParams) {
      url = url.split('?')[0] + '?' + qs.stringify(searchParams);
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

    const fetchResponse: FetchResponse = {
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
        await Promise.all(rawCookies.map((rawCookie: string) => {
          return cookieJar.setCookie(rawCookie, fetchResponse.url)
        }));
      }
    }

    if (fetchOptions.method !== 'HEAD') {
      try {
        if (responseType === 'buffer') {
          fetchResponse.rawBody = await rawResponse.buffer();
        } else {
          fetchResponse.rawBody = await rawResponse.text();
        }
      } catch (err) {
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

    if (!rawResponse.ok) {
      throw new HTTPError(fetchResponse);
    }

    return fetchResponse;
  }).finally(() => {
    clearTimeout(timeoutId);
  });
}

export class RequestError extends Error {
  code?: string;
  stack!: string;
  declare readonly response?: FetchResponse;

  constructor(message: string, error: Partial<Error & {code?: string}>, response?: FetchResponse | undefined) {
    super(message);
    Error.captureStackTrace(this, this.constructor);

    this.name = 'RequestError';
    this.code = error.code;

    if (response) {
      Object.defineProperty(this, 'response', {
        enumerable: false,
        value: response
      });
    }

    if (typeof error.stack !== "undefined") {
      const indexOfMessage = this.stack.indexOf(this.message) + this.message.length;
      const thisStackTrace = this.stack.slice(indexOfMessage).split('\n').reverse();
      const errorStackTrace = error.stack.slice(error.stack.indexOf(error.message!) + error.message!.length).split('\n').reverse();

      // Remove duplicated traces
      while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
        thisStackTrace.shift();
      }

      this.stack = `${this.stack.slice(0, indexOfMessage)}${thisStackTrace.reverse().join('\n')}${errorStackTrace.reverse().join('\n')}`;
    }
  }
}

export class HTTPError extends RequestError {
  declare readonly response: FetchResponse;

  constructor(response: FetchResponse) {
    super(`Response code ${response.statusCode} (${response.statusMessage!})`, {}, response);

    this.name = 'HTTPError';
  }
}

export class TimeoutError extends RequestError {
  declare readonly response: undefined;

  constructor(error: Error) {
    super(error.message, error, undefined);

    this.name = 'TimeoutError';
  }
}

export class ReadError extends RequestError {
  declare readonly response: FetchResponse;

  constructor(error: Error, response: FetchResponse) {
    super(error.message, error, response);
    this.name = 'ReadError';
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