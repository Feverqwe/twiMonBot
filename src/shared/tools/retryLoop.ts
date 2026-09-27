import {setTimeout as wait} from 'node:timers/promises';

interface RetryLoopOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  resetAfterMs?: number;
  onRetry?: (error: unknown, delayMs: number) => void;
  now?: () => number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

const retryLoop = async (
  run: () => Promise<void>,
  signal: AbortSignal,
  options: RetryLoopOptions = {},
): Promise<void> => {
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const resetAfterMs = options.resetAfterMs ?? 60_000;
  const now = options.now ?? Date.now;
  const waitForRetry =
    options.wait ?? ((delayMs, waitSignal) => wait(delayMs, undefined, {signal: waitSignal}));
  let delayMs = initialDelayMs;

  while (!signal.aborted) {
    const startedAt = now();
    let error: unknown;
    try {
      await run();
      error = new Error('Retry loop operation stopped unexpectedly');
    } catch (err) {
      error = err;
    }

    if (signal.aborted) return;
    if (now() - startedAt >= resetAfterMs) delayMs = initialDelayMs;

    options.onRetry?.(error, delayMs);
    try {
      await waitForRetry(delayMs, signal);
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
};

export default retryLoop;
export type {RetryLoopOptions};
