import {describe, expect, test} from '@jest/globals';
import isDatabaseDeadlock from '../../src/shared/tools/isDatabaseDeadlock';

describe('isDatabaseDeadlock', () => {
  test('recognizes MariaDB deadlocks by error code', () => {
    expect(isDatabaseDeadlock({original: {code: 'ER_LOCK_DEADLOCK'}})).toBe(true);
  });

  test('recognizes MariaDB deadlocks by error number', () => {
    expect(isDatabaseDeadlock({parent: {errno: 1213}})).toBe(true);
  });

  test('does not classify other database errors as deadlocks', () => {
    expect(isDatabaseDeadlock({code: 'ER_DUP_ENTRY', errno: 1062})).toBe(false);
  });
});
