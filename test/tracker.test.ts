import {afterEach, describe, expect, jest, test} from '@jest/globals';
import Tracker from '../src/shared/tracker';

describe('Tracker', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    ['123456789', '00000000-0000-4000-8000-000120364c62'],
    ['-1001234567890', '00000000-0000-4000-800b-64798fa5bb6d'],
  ])('creates a stable anonymous UUID for chat %s', (chatId, expected) => {
    const tracker = new Tracker(
      '',
      jest.fn(async () => undefined),
    );
    expect(tracker.getUuid(chatId)).toBe(expected);
    expect(tracker.getUuid(chatId)).toBe(expected);
  });

  test('sends every batch and retains a failed batch for the next attempt', async () => {
    jest.useFakeTimers();
    const fetchRequest = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue(undefined);
    const tracker = new Tracker('tracker-id', fetchRequest);

    for (let index = 0; index < 220; index++) {
      tracker.track(String(index), {t: 'event'});
    }
    await jest.advanceTimersByTimeAsync(1000);

    expect(fetchRequest).toHaveBeenCalledTimes(11);

    tracker.track('next', {t: 'event'});
    await jest.advanceTimersByTimeAsync(1000);

    expect(fetchRequest).toHaveBeenCalledTimes(13);
  });
});
