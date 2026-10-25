import {afterEach, describe, expect, jest, test} from '@jest/globals';
import express from 'express';
import YtPubSub from '../src/ytPubSub';
import type Main from '../src/main';

jest.mock('../src/shared/logFile', () => ({
  __esModule: true,
  default: class {
    write() {}
  },
}));

describe('YtPubSub lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('preserves an accepted feed when saving fails and retries it after recovery', async () => {
    const health = {isAvailable: true};
    const save = jest.fn(async (_feeds: unknown) => {});
    const error = new Error('Connection lost');
    save.mockRejectedValueOnce(error);
    const pubSub = new YtPubSub({
      db: {
        health,
        getExistsYtPubSubChannelIds: async () => ['channel'],
        getExistsFeedIds: async () => [],
        putFeeds: save,
      },
    } as unknown as Main);
    const feed = {
      id: 'video',
      channelId: 'channel',
      title: 'Live',
      channelTitle: 'Channel',
      publishedAt: new Date(),
    };
    pubSub.feeds.push(feed);

    await expect(pubSub.emitFeedsChanges()).rejects.toBe(error);
    expect(pubSub.feeds).toEqual([feed]);
    health.isAvailable = false;
    await pubSub.emitFeedsChanges();
    expect(save).toHaveBeenCalledTimes(1);

    health.isAvailable = true;
    await pubSub.emitFeedsChanges();
    expect(save).toHaveBeenLastCalledWith([feed]);
    expect(pubSub.feeds).toEqual([]);
  });

  test('starts and stops jobs independently of binding HTTP routes', async () => {
    jest.useFakeTimers();
    const pubSub = new YtPubSub({db: {health: {isAvailable: true}}} as Main);
    const update = jest.spyOn(pubSub, 'updateSubscribes').mockResolvedValue(undefined as never);
    const clean = jest.spyOn(pubSub, 'clean').mockResolvedValue(undefined as never);

    pubSub.bind(express());
    await jest.runOnlyPendingTimersAsync();
    expect(update).not.toHaveBeenCalled();
    expect(clean).not.toHaveBeenCalled();

    pubSub.init();
    await jest.runOnlyPendingTimersAsync();
    expect(update).toHaveBeenCalled();
    expect(clean).toHaveBeenCalled();

    pubSub.stop();
    update.mockClear();
    clean.mockClear();
    await jest.runOnlyPendingTimersAsync();
    expect(update).not.toHaveBeenCalled();
    expect(clean).not.toHaveBeenCalled();
  });
});
