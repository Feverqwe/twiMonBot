import {describe, expect, jest, test} from '@jest/globals';
import deleteInBatches from '../../src/shared/tools/deleteInBatches';

describe('deleteInBatches', () => {
  test.each([0, 37])('stops after a partial batch of %i rows', async (count) => {
    const remove = jest.fn<(limit: number) => Promise<number>>().mockResolvedValue(count);
    await expect(deleteInBatches(remove)).resolves.toBe(count);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(100);
  });

  test('yields between full batches and returns the total', async () => {
    const remove = jest
      .fn<(limit: number) => Promise<number>>()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(17);
    const result = deleteInBatches(remove);
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe(217);
    expect(remove.mock.calls).toEqual([[100], [100], [100]]);
  });

  test('checks for exhaustion after an exactly full batch', async () => {
    const remove = jest
      .fn<(limit: number) => Promise<number>>()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(0);
    await expect(deleteInBatches(remove)).resolves.toBe(100);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  test('propagates an error without continuing or retrying', async () => {
    const error = new Error('delete failed');
    const remove = jest
      .fn<(limit: number) => Promise<number>>()
      .mockResolvedValueOnce(100)
      .mockRejectedValueOnce(error);
    await expect(deleteInBatches(remove)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
