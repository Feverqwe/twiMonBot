/**
 * Fixed-window weighted limiter for API quota units.
 *
 * This intentionally does not use `limiter.RateLimiter`: that implementation combines an
 * interval counter with a continuously refilled token bucket. YouTube quota protection needs the
 * full allowance to become available only after this fixed window ends.
 */
const ytCostCounter = (quota: number, interval = 60 * 1000) => {
  assertPositiveFinite('quota', quota);
  assertPositiveFinite('interval', interval);

  const queue: (() => void)[] = [];
  let timeoutId: NodeJS.Timeout | null = null;
  let endAt = 0;
  let used = 0;

  function inc(cost: number, resolve: () => void) {
    const now = Date.now();
    if (now >= endAt) {
      endAt = now + interval;
      used = 0;
    }

    if (used + cost > quota) {
      queue.push(() => inc(cost, resolve));
      if (timeoutId === null) {
        timeoutId = setTimeout(onTimeout, endAt - now);
      }
    } else {
      used += cost;
      resolve();
    }
  }

  function onTimeout() {
    timeoutId = null;
    queue.splice(0).forEach((cb) => cb());
  }

  return {
    inc: (cost: number) => {
      assertPositiveFinite('cost', cost);
      if (cost > quota) {
        throw new RangeError(`cost (${cost}) must not exceed quota (${quota})`);
      }
      return new Promise<void>((resolve) => {
        inc(cost, resolve);
      });
    },
    getRemaining: () => {
      return quota - used;
    },
  };
};

function assertPositiveFinite(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

export default ytCostCounter;
