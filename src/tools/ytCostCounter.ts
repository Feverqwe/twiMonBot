const ytCostCounter = (quota: number) => {
  let startAt = 0;
  let endAt = 0;
  let used = 0;
  const queue: (() => boolean)[] = [];
  let timeoutId: NodeJS.Timeout | null;

  function inc(cost: number, resolve: () => void) {
    const now = Date.now();
    if (now > endAt) {
      startAt = now;
      endAt = now + 60 * 1000;
      used = 0;
    }

    if (used + cost > quota) {
      queue.push(() => inc(cost, resolve));
      if (timeoutId !== null) {
        timeoutId = setTimeout(onTimeout, endAt - now);
      }
      return false;
    } else {
      used += cost;
      resolve();
      return true;
    }
  }

  function onTimeout() {
    timeoutId = null;
    while (queue.length) {
      const cb = queue.shift()!;
      if (!cb()) {
        break;
      }
    }
  }

  return {
    inc: (cost: number) => {
      return new Promise<void>((resolve) => {
        inc(cost, resolve);
      });
    },
    getRemaining: () => {
      return quota - used;
    },
  };
}

export default ytCostCounter;