import {RateLimiter} from "limiter";

class RateLimit2 {
  private limiter: RateLimiter;

  constructor(private limit: number, private interval = 1000) {
    this.limiter = new RateLimiter({
      tokensPerInterval: limit,
      interval,
    });
  }

  wrap<T, A extends any[]>(fn: (...args: A) => T | Promise<T>) {
    return (...args: A) => {
      return this.run(() => fn.apply(null, args));
    };
  }

  run<T>(fn: () => T | Promise<T>) {
    return this.limiter.removeTokens(1).then(() => fn());
  }
}

export default RateLimit2;