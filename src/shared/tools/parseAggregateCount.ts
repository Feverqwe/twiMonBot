export default function parseAggregateCount(value: unknown, queryName: string) {
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'bigint' || (typeof value === 'string' && /^\d+$/.test(value))
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${queryName} did not return a valid aggregate`);
  }
  return count;
}
