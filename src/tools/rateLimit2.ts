class RateLimit2 {
  private queue: (() => void)[] = [];
  private timeArr: number[] = [];
  private countArr: number[] = [];
  private lastTimeoutId: NodeJS.Timeout | null = null;

  constructor(private limit: number, private interval = 1000) {}

  callQueue() {
    const now = Date.now();
    const {count, lastIndex} = this.getAvailableCount(now);
    if (count > 0) {
      if (this.timeArr[0] !== now) {
        const index = this.timeArr.unshift(now);
        this.countArr.unshift(0);
        if (index > this.interval) {
          this.timeArr.splice(this.interval);
          this.countArr.splice(this.interval);
        }
      }
      const fns = this.queue.splice(0, count);
      this.countArr[0] += fns.length;
      fns.forEach(cb => cb());
    }
    if (this.queue.length) {
      const delay = this.interval - (now - this.timeArr[lastIndex]);
      if (this.lastTimeoutId !== null) {
        clearTimeout(this.lastTimeoutId);
      }
      this.lastTimeoutId = setTimeout(() => {
        this.lastTimeoutId = null;
        this.callQueue();
      }, delay);
    }
  }

  getAvailableCount(now: number) {
    const end = now - this.interval;
    let count = 0;
    let lastIndex = 0;
    for (let i = 0, len = this.timeArr.length; i < len; i++) {
      const time = this.timeArr[i];
      if (time < end) break;
      count += this.countArr[i];
      lastIndex = i;
    }
    return {count: this.limit - count, lastIndex};
  }

  wrap<T, A extends any[]>(fn: (...args: A) => T | Promise<T>) {
    return (...args: A) => {
      return new Promise<T>((resolve, reject) => {
        this.queue.push(() => {
          try {
            resolve(fn.apply(null, args));
          } catch (err) {
            reject(err);
          }
        });
        if (this.lastTimeoutId === null) {
          this.callQueue();
        }
      });
    };
  }
}

export default RateLimit2;