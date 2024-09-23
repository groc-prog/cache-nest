/**
 * The available eviction policies.
 */
export enum Policy {
  LRU = 'LRU',
  MRU = 'MRU',
  LFU = 'LFU',
  MFU = 'MFU',
  RR = 'RR',
  FIFO = 'FIFO',
}

export enum Driver {
  MEMORY = 'MEMORY',
  FILE_SYSTEM = 'FILE_SYSTEM',
}

/**
 * Cache/Invalidation identifier provided by a client.
 */
export type Identifier = string | number | boolean | Identifier[] | { [key: string]: Identifier };

/**
 * Cache stored by the active driver.
 * @template T - The expected type of the cache data
 */
export interface Cache<T> {
  /**
   * The identifier of the cache. This identifier is normalized to a internal format before the cache is written. Has
   * to be unique for each cache entry.
   */
  identifier: Identifier;
  /**
   * The number of hits the cache has received.
   * @default 0
   */
  hits: number;
  /**
   * Timestamp of the creation date of the cache. Set internally when a new cache is created.
   */
  ctime: number;
  /**
   * Timestamp of the last time the cache was updated. This includes cache overwrites and hit
   * increases.
   */
  atime: number;
  /**
   * The JSON-compatible data serialized to a string.
   */
  data: T;
  options: {
    /**
     * The TTL (time to live) of the cache in milliseconds. If set, the cache will be invalidated and garbage collected
     * after this amount of time, regardless of whether the eviction policy should evict this cache or not. Will never
     * expire if set to `0`.
     * @default 0
     */
    ttl: number;
    /**
     * A list of identifiers which can be used to manually invalidate the cache. Does not have to be unique.
     * @default []
     */
    invalidatedBy: Identifier[];
  };
  /**
   * Optional metadata stored with the cache. Can be used to attach any additional data to the cache entry.
   */
  metadata?: Record<string, Identifier | Identifier[]>;
}
