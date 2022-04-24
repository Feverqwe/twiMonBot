function getTimeGraph(size = 300) {
  const times: number[] = [];
  const counts: number[] = [];

  function inc() {
    const now = Math.trunc(Date.now() / 1000);
    if (times[0] !== now) {
      const len = times.unshift(now);
      counts.unshift(0);
      if (len > size) {
        times.pop();
        counts.pop();
      }
    }
    counts[0]++;
  }

  function history(max = size) {
    return times.slice(0, max).map((time, index) => {
      return {
        time,
        count: counts[index],
      };
    }, []);
  }

  return {inc, history};
}

export default getTimeGraph;