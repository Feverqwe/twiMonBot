import parallel from "./tools/parallel";
import arrayByPart from "./tools/arrayByPart";
import Main from "./main";
import got from "./tools/gotWithTimeout";
import promiseLimit from "./tools/promiseLimit";

const debug = require('debug')('app:tracker');
const qs = require('querystring');
const uuidV4 = require('uuid/v4');
const QuickLRU = require('quick-lru');
const throttle = require('lodash.throttle');

const oneLimit = promiseLimit(1);

class Tracker {
  main: Main;
  tid: string;
  lru: typeof QuickLRU;
  defaultParams: {[s: string]: string|number};
  queue: [number, {[s: string]: string|number}][];
  constructor(main: Main) {
    this.main = main;
    this.tid = main.config.gaId;
    this.lru = new QuickLRU({maxSize: 100});

    this.defaultParams = {
      v: 1,
      tid: this.tid,
      an: 'bot',
      aid: 'bot'
    };

    this.queue = [];
  }

  track(chatId: number|string, params: {[s: string]: string|number}) {
    const cid = this.getUuid(chatId);

    this.queue.push([Date.now(), Object.assign({cid}, this.defaultParams, params)]);

    this.sendDataThrottled();
  }

  sendData = () => {
    return oneLimit(async () => {
      while (this.queue.length) {
        const queue = this.queue.splice(0);
        await parallel(10, arrayByPart(queue, 20), (queue) => {
          return got.post('https://www.google-analytics.com/batch', {
            headers: {
              'Content-Type': 'text/html'
            },
            body: queue.map(([time, hit]) => {
              hit.qt = Date.now() - time;
              return qs.stringify(hit);
            }).join('\n'),
          }).catch((err: any) => {
            const fourHoursAgo = new Date();
            fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);
            queue.forEach(([time, hit]) => {
              if (time > fourHoursAgo.getTime()) {
                this.queue.unshift([time, hit]);
              }
            });
            throw err;
          });
        });
      }
    }).catch((err: any) => {
      debug('track error: %o', err);
    });
  };
  sendDataThrottled = throttle(this.sendData, 1000, {
    leading: false
  });

  getUuid(chatId: number|string) {
    if (this.lru.has(chatId)) {
      return this.lru.get(chatId);
    }

    let vId: any = chatId;

    let prefix = 0;
    if (vId < 0) {
      prefix = 1;
      vId *= -1;
    }

    const idParts = vId.toString().split('').reverse().join('').match(/(\d{0,2})/g).reverse();

    const random = new Array(16);
    for (let i = 0; i < 16; i++) {
      random[i] = 0x0;
    }

    let index = random.length;
    let part;
    while (part = idParts.pop()) {
      index--;
      random[index] = parseInt(`${prefix}${part}`, 10);
    }

    const result = uuidV4({random});

    this.lru.set(chatId, result);

    return result;
  }
}

export default Tracker;