import promiseFinally from "./promiseFinally";

const getProvider = (requestDataById, keepAlive = 0) => {
  const idCacheMap = new Map();
  const inflightCache = {};

  return (id, callback) => {
    const key = `key-${id}`;

    return Promise.resolve().then(() => {
      const cache = idCacheMap.get(id);
      if (cache) {
        return cache;
      }

      if (inflightCache[key]) {
        return inflightCache[key];
      }

      return inflightCache[key] = requestDataById(id).then((result) => {
        const cache = {useCount: 0, result};
        idCacheMap.set(id, cache);
        return cache;
      }).then(...promiseFinally(() => {
        delete inflightCache[key];
      }));
    }).then((cache) => {
      cache.useCount++;
      return Promise.resolve(callback(cache.result)).then(...promiseFinally(() => {
        cache.useCount--;
        clearTimeout(cache.timerId);
        cache.timerId = setTimeout(() => {
          if (!cache.useCount) {
            idCacheMap.delete(id);
          }
        }, keepAlive);
      }));
    });
  }
};

export default getProvider;
