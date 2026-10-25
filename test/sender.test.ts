import {describe, expect, jest, test} from '@jest/globals';
import Sender from '../src/sender';
import type ChatSender from '../src/chatSender';
import type Main from '../src/main';

const createSender = () => {
  const databaseHealth = {isAvailable: true};
  const queueChats = jest.fn(async (): Promise<string[]> => []);
  const db = {
    health: databaseHealth,
    setChatSendTimeoutExpiresAt: jest.fn(async (_ids: string[]) => {}),
    getDistinctChatIdStreamIdChatIds: queueChats,
    getDistinctChatIdVideoIdChatIds: queueChats,
    getDistinctMessagesChatIds: jest.fn(async (): Promise<string[]> => []),
  };
  const sender = new Sender({db} as unknown as Main);
  const next = jest.fn(async (): Promise<boolean> => true);
  const worker = {chat: {id: '42'}, next} as unknown as ChatSender;
  sender.chatIdChatSender.set('42', worker);
  sender.suspended.push(worker);
  return {sender, databaseHealth, db, next, queueChats};
};

describe('Sender outage recovery', () => {
  test('propagates a database failure and prevents another query while the database is down', async () => {
    const {sender, databaseHealth, queueChats} = createSender();
    const error = new Error('Connection lost');
    queueChats.mockRejectedValue(error);
    await expect(sender.check()).rejects.toBe(error);

    databaseHealth.isAvailable = false;
    await expect(sender.check()).resolves.toBeUndefined();
    expect(queueChats).toHaveBeenCalledTimes(1);
  });

  test('releases a worker even when persisting the send timeout fails', async () => {
    const {sender, db, next} = createSender();
    next.mockRejectedValue(new Error('Telegram unavailable'));
    const error = new Error('Database unavailable');
    db.setChatSendTimeoutExpiresAt.mockRejectedValue(error);

    await expect(sender.runThread()).rejects.toBe(error);
    expect(sender.threads).toHaveLength(0);
    expect(sender.chatIdChatSender.size).toBe(0);
  });

  test('retains queued work while the database is down and sends it after recovery', async () => {
    const {sender, databaseHealth, next} = createSender();
    databaseHealth.isAvailable = false;
    await expect(sender.runThread()).resolves.toBeUndefined();
    expect(next).not.toHaveBeenCalled();

    databaseHealth.isAvailable = true;
    await sender.runThread();
    expect(next).toHaveBeenCalledTimes(1);
    expect(sender.threads).toHaveLength(0);
    expect(sender.chatIdChatSender.size).toBe(0);
  });

  test('does not attempt another database write once an outage is detected', async () => {
    const {sender, databaseHealth, db, next} = createSender();
    next.mockImplementation(async () => {
      databaseHealth.isAvailable = false;
      throw new Error('Connection lost');
    });

    await sender.runThread();
    expect(db.setChatSendTimeoutExpiresAt).not.toHaveBeenCalled();
    expect(sender.threads).toHaveLength(0);
  });
});
