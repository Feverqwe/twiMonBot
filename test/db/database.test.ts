import {afterEach, describe, expect, jest, test} from '@jest/globals';
import Db from '../../src/db/database';
import {ChannelModel, ChatIdChannelIdModel} from '../../src/db/models';

describe('Db aggregate queries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reads top channel aggregate aliases from Sequelize data values', async () => {
    const get = jest.fn((_options?: unknown) => ({
      channelId: 'youtube:channel',
      chatCount: '3',
      channel: {title: 'Channel', service: 'youtube'},
    }));
    jest.spyOn(ChatIdChannelIdModel, 'findAll').mockResolvedValue([{get}] as never);

    const db = Object.create(Db.prototype) as Db;
    await expect(db.getChatIdChannelIdTop10ByServiceId('youtube')).resolves.toEqual([
      {
        channelId: 'youtube:channel',
        chatCount: 3,
        title: 'Channel',
        service: 'youtube',
      },
    ]);
    expect(get).toHaveBeenCalledWith({plain: true});
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
