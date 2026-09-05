import pMap from 'p-map';

const parallel = <T, R>(
  limit: number,
  items: T[],
  callback: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> => {
  return pMap(items, callback, {concurrency: limit});
};

export default parallel;
