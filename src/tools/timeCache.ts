import QuickLRU from "quick-lru";

class TimeCache<KeyType extends unknown, ValueType extends unknown> {
  private readonly ttl: number;
  private lru: QuickLRU<KeyType, {data: ValueType, expiresAt: number}>;
  constructor(options: QuickLRU.Options<KeyType, {data: ValueType, expiresAt: number}> & {ttl: number}) {
    this.lru = new QuickLRU<KeyType, {data: ValueType, expiresAt: number}>(options);
    this.ttl = options.ttl;
  }

  get(key: KeyType) {
    let result = this.lru.get(key);
    if (result && result.expiresAt < Date.now()) {
      this.lru.delete(key);
      result = undefined;
    }
    return result && result.data;
  }

  set(key: KeyType, value: ValueType) {
    return this.lru.set(key, {
      data: value,
      expiresAt: Date.now() + this.ttl
    });
  }
}

export default TimeCache;