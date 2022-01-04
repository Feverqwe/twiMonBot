class RateLimit {
  limit: number;
  interval: number;
  queue: (() => any)[] = [];
  time = 0;
  count = 0;
  timerId: NodeJS.Timeout | null = null;
  constructor(limit: number, interval?: number) {
    this.limit = limit;
    this.interval = interval || 1000;
  }

  _next() {
    if (this.timerId !== null) return;

    const now = Date.now();
    if (now - this.time >= this.interval) {
      this.time = now;
      this.count = 0;
    }

    while (this.queue.length && this.count < this.limit) {
      this.count++;
      const callback = this.queue.shift()!;
      callback();
    }

    if (this.count === this.limit) {
      this.timerId = setTimeout(() => {
        this.timerId = null;
        this._next();
      }, this.interval - (Date.now() - this.time));
    }
  }

  wrap<T, A extends any[]>(callback: (...args: A) => T | Promise<T>) {
    return (...args: A) => {
      return new Promise<T>((resolve, reject) => {
        this.queue.push(() => {
          try {
            resolve(callback.apply(null, args));
          } catch (err) {
            reject(err);
          }
        });
        this._next();
      });
    };
  };
}

export default RateLimit;