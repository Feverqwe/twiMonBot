import {describe, expect, jest, test} from '@jest/globals';
import retryLoop from '../../src/shared/tools/retryLoop';

describe('retryLoop', () => {
  test('restarts a failed operation with capped exponential backoff', async () => {
    const controller = new AbortController();
    const run = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('failed'));
    const delays: number[] = [];
    let releaseWait: (() => void) | undefined;
    const wait = jest.fn((delayMs: number) => {
      delays.push(delayMs);
      return new Promise<void>((resolve) => {
        releaseWait = resolve;
      });
    });

    const loop = retryLoop(run, controller.signal, {
      initialDelayMs: 10,
      maxDelayMs: 20,
      wait,
    });
    await Promise.resolve();
    expect(delays).toEqual([10]);

    releaseWait!();
    await Promise.resolve();
    await Promise.resolve();
    expect(delays).toEqual([10, 20]);

    releaseWait!();
    await Promise.resolve();
    await Promise.resolve();
    expect(delays).toEqual([10, 20, 20]);

    controller.abort();
    releaseWait!();
    await loop;
  });

  test('stops without retrying when aborted operation rejects', async () => {
    const controller = new AbortController();
    const error = new Error('stopped');
    const run = jest.fn(async () => {
      controller.abort();
      throw error;
    });
    const onRetry = jest.fn();

    await retryLoop(run, controller.signal, {onRetry});

    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
