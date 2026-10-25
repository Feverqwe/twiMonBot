import {afterEach, describe, expect, jest, test} from '@jest/globals';
import DatabaseHealth from '../src/shared/databaseHealth';

const createHealth = () => {
  const authenticate = jest.fn(async (): Promise<void> => {});
  const health = new DatabaseHealth({authenticate}, 1);
  return {health, authenticate};
};

describe('DatabaseHealth', () => {
  const monitors: DatabaseHealth[] = [];
  afterEach(async () => {
    await Promise.all(monitors.splice(0).map((health) => health.stop()));
  });

  test('does not complete startup until the database responds', async () => {
    const {health, authenticate} = createHealth();
    monitors.push(health);
    let respond!: () => void;
    authenticate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          respond = resolve;
        }),
    );
    const ready = jest.fn();
    const started = health.start().then(ready);
    expect(ready).not.toHaveBeenCalled();
    respond();
    await started;
    expect(ready).toHaveBeenCalledTimes(1);
    expect(health.isAvailable).toBe(true);
  });

  test('retries startup when the database is not running yet', async () => {
    const {health, authenticate} = createHealth();
    monitors.push(health);
    authenticate.mockRejectedValueOnce(new Error('Connection refused'));
    await health.start();
    expect(authenticate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(health.isAvailable).toBe(true);
  });

  test('the background interval detects an outage and recovery', async () => {
    const {health, authenticate} = createHealth();
    monitors.push(health);
    await health.start();
    let respond!: () => void;
    let notifyProbe!: () => void;
    const recovering = new Promise<void>((resolve) => {
      notifyProbe = resolve;
    });
    authenticate.mockRejectedValueOnce(new Error('Connection lost'));
    authenticate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          respond = resolve;
          notifyProbe();
        }),
    );
    await recovering;
    expect(health.isAvailable).toBe(false);
    respond();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(health.isAvailable).toBe(true);
  });

  test('a late probe response cannot restore readiness after stopping', async () => {
    const {health, authenticate} = createHealth();
    monitors.push(health);
    let respond!: () => void;
    authenticate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          respond = resolve;
        }),
    );
    const started = health.start();
    const stopped = health.stop();
    respond();
    await expect(started).rejects.toMatchObject({name: 'AbortError'});
    await stopped;
    expect(health.isAvailable).toBe(false);
  });

  test('stopping while the database is down cancels startup', async () => {
    const {health, authenticate} = createHealth();
    monitors.push(health);
    authenticate.mockRejectedValue(new Error('Connection refused'));
    const started = health.start();
    await health.stop();
    await expect(started).rejects.toMatchObject({name: 'AbortError'});
    expect(health.isAvailable).toBe(false);
  });
});
