const secondMs = 1000;
const minuteMs = 60 * secondMs;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const everyTime = (
  ms: number | {ms: number; offset?: number},
  callback: () => any,
): (() => void) => {
  let _ms = 0;
  let _offset: number | undefined = 0;
  if (typeof ms === 'object') {
    _offset = ms.offset;
    _ms = ms.ms;
  } else {
    _ms = ms;
  }

  let offsetTimeoutId: NodeJS.Timeout | null = null;
  let intervalId: NodeJS.Timeout | null = null;

  offsetTimeoutId = setTimeout(
    () => {
      intervalId = setInterval(() => {
        callback();
      }, _ms);
      callback();
    },
    getOffset(_ms, _offset),
  );

  return () => {
    clearTimeout(offsetTimeoutId!);
    clearInterval(intervalId!);
  };
};

const everyMinutes = (minutes: number, callback: () => any) => {
  return everyTime({ms: minutes * minuteMs}, callback);
};

const everyHourAt = (minutes: number, callback: () => any) => {
  return everyTime({ms: hourMs, offset: minutes * minuteMs}, callback);
};

const everyDayAt = (hours: number, minutes: number, callback: () => any) => {
  return everyTime({ms: dayMs, offset: hours * hourMs + minutes * minuteMs}, callback);
};

const everyWeekAt = (day: number, hours: number, minutes: number, callback: () => any) => {
  return everyTime(
    {ms: 7 * dayMs, offset: day * dayMs + hours * hourMs + minutes * minuteMs},
    callback,
  );
};

function getOffset(step: number, offset = 0) {
  if (!Number.isFinite(step) || step <= 0) throw new Error(`Incorrect step value ${step}`);

  const now = new Date();

  let pos = now.getMilliseconds();
  if (step >= 7 * dayMs) {
    pos += now.getDay() * dayMs;
  }
  if (step >= dayMs) {
    pos += now.getHours() * hourMs;
  }
  if (step >= hourMs) {
    pos += now.getMinutes() * minuteMs;
  }
  if (step >= minuteMs) {
    pos += now.getSeconds() * secondMs;
  }

  return (((offset - pos) % step) + step) % step;
}

export default everyTime;
export {everyMinutes, everyHourAt, everyDayAt, everyWeekAt};
