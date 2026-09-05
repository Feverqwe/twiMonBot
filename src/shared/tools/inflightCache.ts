const inflightCacheProvider = () => {
  const inflightCache = new Map<unknown, Promise<unknown>>();

  return <K, T>(key: K, callback: () => Promise<T>) => {
    let promise = inflightCache.get(key);
    if (!promise) {
      promise = callback().finally(() => {
        inflightCache.delete(key);
      });
      inflightCache.set(key, promise);
    }
    return promise as Promise<T>;
  };
};

export default inflightCacheProvider;
