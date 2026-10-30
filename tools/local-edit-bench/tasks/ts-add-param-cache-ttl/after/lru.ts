export class LruCache<K, V> {
  private map = new Map<K, { value: V; insertedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = Infinity,
  ) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
  }

  get size(): number {
    return this.map.size;
  }

  private expired(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return true;
    if (this.now() - entry.insertedAt >= this.ttlMs) {
      this.map.delete(key);
      return true;
    }
    return false;
  }

  has(key: K): boolean {
    return !this.expired(key);
  }

  get(key: K): V | undefined {
    if (this.expired(key)) return undefined;
    const entry = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, insertedAt: this.now() });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }
}
