import {afterEach, describe, expect, jest, test} from '@jest/globals';
import {Sequelize, Transaction} from 'sequelize';
import Db from '../../src/db/database';
import {
  ChannelModel,
  ChatIdChannelIdModel,
  ChatIdStreamIdModel,
  ChatModel,
  MessageModel,
} from '../../src/db/models';

describe('Db aggregate queries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createDb = () => {
    const db = Object.create(Db.prototype) as Db;
    Object.assign(db, {
      sequelize: {
        transaction: async (
          _options: unknown,
          callback: (transaction: unknown) => Promise<unknown>,
        ) => callback({}),
      },
    });
    return db;
  };

  test('combines aggregate counts and channel details in ranking order', async () => {
    jest
      .spyOn(ChatIdChannelIdModel, 'findAll')
      .mockResolvedValue([
        {get: () => ({channelId: 'youtube:first', chatCount: '12'})},
        {get: () => ({channelId: 'youtube:second', chatCount: 3n})},
      ] as never);
    jest.spyOn(ChannelModel, 'findAll').mockResolvedValue([
      {id: 'youtube:second', title: 'Second', service: 'youtube'},
      {id: 'youtube:first', title: 'First', service: 'youtube'},
    ] as never);

    await expect(createDb().getChatIdChannelIdTop10ByServiceId('youtube')).resolves.toEqual([
      {channelId: 'youtube:first', chatCount: 12, title: 'First', service: 'youtube'},
      {channelId: 'youtube:second', chatCount: 3, title: 'Second', service: 'youtube'},
    ]);
  });

  test('returns an empty top when no channels qualify', async () => {
    jest.spyOn(ChatIdChannelIdModel, 'findAll').mockResolvedValue([]);
    await expect(createDb().getChatIdChannelIdTop10ByServiceId('youtube')).resolves.toEqual([]);
  });

  test('rejects incomplete channel details instead of silently dropping a ranked channel', async () => {
    jest
      .spyOn(ChatIdChannelIdModel, 'findAll')
      .mockResolvedValue([{get: () => ({channelId: 'youtube:first', chatCount: '12'})}] as never);
    jest.spyOn(ChannelModel, 'findAll').mockResolvedValue([]);
    await expect(createDb().getChatIdChannelIdTop10ByServiceId('youtube')).rejects.toThrow(
      'Top channel query did not return all selected fields',
    );
  });

  test('reads service aggregate aliases from Sequelize data values', async () => {
    const get = jest.fn((_options?: unknown) => ({service: 'youtube', channelCount: 12n}));
    jest.spyOn(ChannelModel, 'findAll').mockResolvedValue([{get}] as never);

    const db = Object.create(Db.prototype) as Db;
    await expect(db.getServiceIdChannelCount(['youtube'])).resolves.toEqual([
      {service: 'youtube', channelCount: 12},
    ]);
    expect(get).toHaveBeenCalledWith({plain: true});
  });
});

describe('Db stream delivery confirmation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([null, 'message', 'queue'] as const)(
    'commits both writes or rolls back a failed confirmation: %s',
    async (failure) => {
      const sequelize = new Sequelize('test', 'test', 'test', {
        dialect: 'mariadb',
        logging: false,
      });
      // Run Sequelize's managed transaction lifecycle without connecting to MariaDB.
      jest.spyOn(sequelize.connectionManager, 'getConnection').mockResolvedValue({} as never);
      jest.spyOn(sequelize.connectionManager, 'releaseConnection').mockImplementation(() => {});
      jest.spyOn(sequelize, 'query').mockResolvedValue([] as never);
      const commit = jest.spyOn(Transaction.prototype, 'commit');
      const rollback = jest.spyOn(Transaction.prototype, 'rollback');
      const create = jest.spyOn(MessageModel, 'create').mockResolvedValue({} as never);
      const remove = jest.spyOn(ChatIdStreamIdModel, 'destroy').mockResolvedValue(1);
      const error = new Error('Database write failed');
      if (failure === 'message') create.mockRejectedValue(error);
      if (failure === 'queue') remove.mockRejectedValue(error);

      const db = Object.create(Db.prototype) as Db;
      db.sequelize = sequelize;
      const message = {
        id: '123',
        chatId: '42',
        streamId: 'tw:1',
        type: 'text',
        text: 'Stream is live',
      };

      try {
        const result = db.confirmStreamMessage(message);
        if (failure) {
          await expect(result).rejects.toBe(error);
          expect(rollback).toHaveBeenCalledTimes(1);
          expect(commit).not.toHaveBeenCalled();
        } else {
          await expect(result).resolves.toBeUndefined();
          expect(commit).toHaveBeenCalledTimes(1);
          expect(rollback).not.toHaveBeenCalled();
        }

        const transaction = create.mock.calls[0][1]?.transaction;
        expect(transaction).toBeInstanceOf(Transaction);
        if (failure === 'message') {
          expect(remove).not.toHaveBeenCalled();
        } else {
          expect(remove).toHaveBeenCalledWith({
            where: {chatId: message.chatId, streamId: message.streamId},
            transaction,
          });
        }
      } finally {
        await sequelize.close();
      }
    },
  );
});

describe('Db chat initialization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('loads the channel association for a newly created chat', async () => {
    const chat = {
      id: '42',
      channel: undefined as ChatModel | null | undefined,
      reload: jest.fn(async () => {
        chat.channel = null;
        return chat;
      }),
    };
    jest.spyOn(ChatModel, 'findOrCreate').mockResolvedValue([chat, true] as never);

    const db = Object.create(Db.prototype) as Db;
    await expect(db.ensureChat('42')).resolves.toMatchObject({id: '42', channel: null});
  });

  test.each([null, {id: '-10042'}])(
    'preserves an existing channel association: %j',
    async (channel) => {
      const chat = {id: '42', channel};
      jest.spyOn(ChatModel, 'findOrCreate').mockResolvedValue([chat, false] as never);

      const db = Object.create(Db.prototype) as Db;
      await expect(db.ensureChat('42')).resolves.toMatchObject({id: '42', channel});
    },
  );

  test('propagates an association reload failure instead of returning an incomplete chat', async () => {
    const error = new Error('Database unavailable');
    const chat = {
      id: '42',
      reload: jest.fn(async () => {
        throw error;
      }),
    };
    jest.spyOn(ChatModel, 'findOrCreate').mockResolvedValue([chat, true] as never);

    const db = Object.create(Db.prototype) as Db;
    await expect(db.ensureChat('42')).rejects.toBe(error);
  });
});
