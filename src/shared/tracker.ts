import qs from 'node:querystring';
import throttle from 'lodash.throttle';
import QuickLRU from 'quick-lru';
import {v4 as uuidV4} from 'uuid';
import arrayByPart from './tools/arrayByPart';
import {getDebug} from './tools/getDebug';
import parallel from './tools/parallel';
import promiseLimit from './tools/promiseLimit';

const debug = getDebug('app:tracker');
const oneLimit = promiseLimit(1);

interface TrackerFetchOptions {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  keepAlive: boolean;
}

type TrackerFetch = (url: string, options: TrackerFetchOptions) => Promise<unknown>;
type TrackerParams = Record<string, string | number>;

class Tracker {
  private readonly defaultParams: TrackerParams;
  private readonly lru = new QuickLRU<string | number, string>({maxSize: 100});
  private readonly queue: [number, TrackerParams][] = [];

  constructor(
    private readonly tid: string,
    private readonly fetchRequest: TrackerFetch,
  ) {
    this.defaultParams = {
      v: 1,
      tid,
      an: 'bot',
      aid: 'bot',
    };
  }

  track(chatId: number | string, params: TrackerParams) {
    if (!this.tid) return;
    const cid = this.getUuid(chatId);

    this.queue.push([Date.now(), Object.assign({cid}, this.defaultParams, params)]);
    this.sendDataThrottled();
  }

  private sendData = () => {
    return oneLimit(async () => {
      while (this.queue.length) {
        const queue = this.queue.splice(0);
        await parallel(10, arrayByPart(queue, 20), (part) => {
          return this.fetchRequest('https://www.google-analytics.com/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'text/html',
            },
            body: part
              .map(([time, hit]) => {
                hit.qt = Date.now() - time;
                return qs.stringify(hit);
              })
              .join('\n'),
            keepAlive: true,
          }).catch((error: unknown) => {
            const fourHoursAgo = new Date();
            fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);
            part.forEach(([time, hit]) => {
              if (time > fourHoursAgo.getTime()) {
                this.queue.unshift([time, hit]);
              }
            });
            throw error;
          });
        });
      }
    }).catch((error: unknown) => {
      debug('track error: %o', error);
    });
  };

  private readonly sendDataThrottled = throttle(this.sendData, 1000, {
    leading: false,
  });

  getUuid(chatId: number | string) {
    const cachedUuid = this.lru.get(chatId);
    if (cachedUuid) {
      return cachedUuid;
    }

    let value = chatId.toString();
    let prefix = 0;
    if (value.startsWith('-')) {
      prefix = 1;
      value = value.slice(1);
    }

    const idParts = value
      .split('')
      .reverse()
      .join('')
      .match(/(\d{0,2})/g)!
      .reverse();
    const random = new Uint8Array(16);

    let index = random.length;
    let part;
    while ((part = idParts.pop())) {
      index--;
      random[index] = parseInt(`${prefix}${part}`, 10);
    }

    const result = uuidV4({random});
    this.lru.set(chatId, result);
    return result;
  }
}

export default Tracker;
