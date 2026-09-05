import {afterEach, describe, expect, jest, test} from '@jest/globals';
import ytCostCounter from '../../src/shared/tools/ytCostCounter';

describe('ytCostCounter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('accounts for weighted costs and releases queued work at the window boundary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const counter = ytCostCounter(3, 1_000);

    await counter.inc(2);
    const queued = counter.inc(2);
    const onQueued = jest.fn();
    void queued.then(onQueued);
    await counter.inc(1);

    expect(counter.getRemaining()).toBe(0);
    expect(onQueued).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    await queued;

    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(counter.getRemaining()).toBe(1);
  });

  test('keeps overflow queued across multiple windows', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const counter = ytCostCounter(2, 1_000);

    await counter.inc(2);
    const first = counter.inc(2);
    const second = counter.inc(2);
    const onFirst = jest.fn();
    const onSecond = jest.fn();
    void first.then(onFirst);
    void second.then(onSecond);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onSecond).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, second]);
    expect(onSecond).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['quota', () => ytCostCounter(0)],
    ['interval', () => ytCostCounter(1, Number.POSITIVE_INFINITY)],
    ['cost', () => ytCostCounter(1).inc(0)],
    ['cost above quota', () => ytCostCounter(1).inc(2)],
  ])('rejects invalid %s instead of leaving work pending', (name, callback) => {
    expect(callback).toThrow(RangeError);
  });
});
