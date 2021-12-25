import promiseTry from "./promiseTry";

const itemWeakMap = new WeakMap();

class PromiseQueue {
  limit: number;
  queue: [() => any, Function][];
  activeCount: number;

  constructor(limit: number) {
    this.limit = limit;
    this.queue = [];
    this.activeCount = 0;
  }

  add<T>(callback: () => T | PromiseLike<T>) {
    let resolve!: (result: T) => void;
    const promise = new Promise<T>((_resolve) => {
      resolve = _resolve;
    });
    if (this.activeCount < this.limit) {
      this.runQueue(callback, resolve);
    } else {
      const item = [callback, resolve] as [() => any, Function];
      this.queue.push(item);
      itemWeakMap.set(callback, item);
      itemWeakMap.set(promise, item);
    }
    return promise;
  }

  remove(callbackOrPromise: Promise<any>|(() => any), err?: Error) {
    const item = itemWeakMap.get(callbackOrPromise);
    if (item && removeFromArray(this.queue, item)) {
      if (err) {
        item[1](Promise.reject(err));
      }
      return true;
    }
    return false;
  }

  runQueue(callback: Function, resolve: Function) {
    this.activeCount++;
    const promise = promiseTry(callback as () => any);
    resolve(promise);
    promise.then(this.finishQueue, this.finishQueue);
  }

  finishQueue = () => {
    this.activeCount--;
    if (this.queue.length > 0) {
      const [callback, resolve] = this.queue.shift()!;
      this.runQueue(callback, resolve);
    }
  }
}

function removeFromArray(arr: Array<any>, item: any) {
  const pos = arr.indexOf(item);
  if (pos !== -1) {
    arr.splice(pos, 1);
    return true;
  }
  return false;
}

export default PromiseQueue;