import {afterEach, describe, expect, jest, test} from '@jest/globals';
import {everyDayAt, everyHourAt, everyMinutes, everyWeekAt} from '../../src/shared/tools/everyTime';

describe('everyTime calendar helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('runs everyHourAt at the requested minute of the next hour', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 5, 10, 50, 30, 250));
    const callback = jest.fn();
    const cancel = everyHourAt(15, callback);

    jest.advanceTimersByTime(24 * 60 * 1000 + 29_749);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    cancel();
  });

  test('aligns a one-minute interval to the next minute boundary', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 5, 10, 50, 30, 250));
    const callback = jest.fn();
    const cancel = everyMinutes(1, callback);

    jest.advanceTimersByTime(29_749);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    cancel();
  });

  test('runs everyDayAt at the requested local time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 5, 10, 50, 30, 250));
    const callback = jest.fn();
    const cancel = everyDayAt(15, 20, callback);

    jest.advanceTimersByTime(4 * 60 * 60 * 1000 + 29 * 60 * 1000 + 29_749);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    cancel();
  });

  test('runs everyWeekAt on the requested local weekday and time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 5, 10, 50, 30, 250));
    const callback = jest.fn();
    const cancel = everyWeekAt(2, 9, 10, callback);
    const delay = 22 * 60 * 60 * 1000 + 19 * 60 * 1000 + 29_750;

    jest.advanceTimersByTime(delay - 1);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    cancel();
  });
});
