import promiseTry from "./promiseTry";

type Cache<T> = {useCount: number, result: T, timerId?: NodeJS.Timeout};

const getProvider = <I, T, R>(requestDataById: (id: I) => Promise<T>, keepAlive = 0): (id: I, callback: (result: T) => R) => Promise<R> => {
  const idCacheMap = new Map<I, Cache<T>>();
  const inflightCache: Partial<Record<string, Promise<Cache<T>>>> = {};

  return (id, callback) => {
    const key = `key-${id}`;

    return promiseTry(() => {
      const cache = idCacheMap.get(id);
      if (cache) {
        return cache;
      }

      const inflightPromise = inflightCache[key];
      if (inflightPromise) {
        return inflightPromise;
      }

      return inflightCache[key] = requestDataById(id).then((result) => {
        const cache: Cache<T> = {useCount: 0, result};
        idCacheMap.set(id, cache);
        return cache;
      }).finally(() => {
        delete inflightCache[key];
      });
    }).then((cache) => {
      cache.useCount++;
      return promiseTry(() => callback(cache.result)).finally(() => {
        cache.useCount--;
        cache.timerId && clearTimeout(cache.timerId);
        cache.timerId = setTimeout(() => {
          if (!cache.useCount) {
            idCacheMap.delete(id);
          }
        }, keepAlive);
      });
    });
  }
};

export default getProvider;
