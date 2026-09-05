import inflightCacheProvider from './inflightCache';

type Cache<T> = {useCount: number; result: T; timerId?: NodeJS.Timeout};

const getProvider = <I, T, R>(
  requestDataById: (id: I) => Promise<T>,
  keepAlive = 0,
): ((id: I, callback: (result: T) => R) => Promise<R>) => {
  const infCache = inflightCacheProvider();
  const idCacheMap = new Map<I, Cache<T>>();

  return async (id, callback) => {
    let cache = idCacheMap.get(id);
    if (!cache) {
      cache = await infCache(id, async () => {
        const result = await requestDataById(id);
        const cache = {
          useCount: 0,
          result,
        };
        idCacheMap.set(id, cache);
        return cache;
      });
    }
    const cacheLocal = cache;

    cache.useCount++;
    try {
      return await callback(cache.result);
    } finally {
      cache.useCount--;
      if (cache.timerId) {
        clearTimeout(cache.timerId);
      }
      cache.timerId = setTimeout(() => {
        if (cacheLocal.useCount === 0) {
          idCacheMap.delete(id);
        }
      }, keepAlive);
    }
  };
};

export default getProvider;
