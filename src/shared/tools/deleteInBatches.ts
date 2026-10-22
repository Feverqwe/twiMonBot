import {setTimeout as wait} from 'node:timers/promises';

// Limit parent rows per statement; foreign-key cascades can delete additional rows.
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 100;

const deleteInBatches = async (
  deleteBatch: (limit: number) => Promise<number>,
): Promise<number> => {
  let total = 0;
  while (true) {
    const deleted = await deleteBatch(BATCH_SIZE);
    total += deleted;
    if (deleted < BATCH_SIZE) return total;
    await wait(BATCH_PAUSE_MS);
  }
};

export default deleteInBatches;
