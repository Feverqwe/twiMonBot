import {afterEach, describe, expect, jest, test} from '@jest/globals';
import Db from '../../src/db/database';
import {ChannelModel, ChatIdChannelIdModel} from '../../src/db/models';

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
