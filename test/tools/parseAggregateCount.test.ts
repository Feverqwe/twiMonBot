import {describe, expect, test} from '@jest/globals';
import parseAggregateCount from '../../src/shared/tools/parseAggregateCount';

describe('parseAggregateCount', () => {
  test.each([
    [0, 0],
    ['12', 12],
    [23n, 23],
  ])('normalizes %s to a number', (value, expected) => {
    expect(parseAggregateCount(value, 'Query')).toBe(expected);
  });

  test.each([-1, '-1', 1.5, 'value', undefined, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
    'rejects invalid aggregate %s',
    (value) => {
      expect(() => parseAggregateCount(value, 'Query')).toThrow(
        'Query did not return a valid aggregate',
      );
    },
  );
});
