const ytCostCounter = (quota: number, interval = 60 * 1000) => {
  const queue: (() => void)[] = [];
  let timeoutId: NodeJS.Timeout | null = null;
  let endAt = 0;
  let used = 0;

  function inc(cost: number, resolve: () => void) {
    const now = Date.now();
    if (now > endAt) {
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
    queue.splice(0).forEach(cb => cb());
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