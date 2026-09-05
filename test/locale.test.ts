import {describe, expect, test} from '@jest/globals';
import Locale from '../src/shared/locale';

describe('Locale', () => {
  test('uses Russian for a regional Russian language code', () => {
    expect(new Locale('ru-RU').m('context-user-count', {count: 3})).toBe('Пользователи: 3');
  });

  test('falls back to English for an unsupported language', () => {
    expect(new Locale('de').m('context-user-count', {count: 3})).toBe('Users: 3');
  });
});
