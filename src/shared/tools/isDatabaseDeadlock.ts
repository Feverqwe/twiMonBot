const DEADLOCK_ERROR_CODE = 'ER_LOCK_DEADLOCK';
const DEADLOCK_ERROR_NUMBER = 1213;

interface DatabaseErrorDetails {
  code?: unknown;
  errno?: unknown;
  parent?: unknown;
  original?: unknown;
}

const isDatabaseDeadlock = (error: unknown): boolean => {
  const pending = [error];
  const visited = new Set<unknown>();

  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    const details = current as DatabaseErrorDetails;
    if (details.code === DEADLOCK_ERROR_CODE || details.errno === DEADLOCK_ERROR_NUMBER)
      return true;
    pending.push(details.parent, details.original);
  }

  return false;
};

export default isDatabaseDeadlock;
