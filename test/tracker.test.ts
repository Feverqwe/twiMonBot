import {describe, expect, jest, test} from '@jest/globals';
import Tracker from '../src/shared/tracker';

describe('Tracker', () => {
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
});
