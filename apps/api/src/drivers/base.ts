import type { MaybePromise } from 'elysia';
import type { Logger } from 'winston';

import type { Cache, Driver, Policy, Identifier } from '@cache-nest/types';

import type { CreateCache } from '@/types/cache';
import logger from '@/utils/logger';

export abstract class BaseDriver {
  driver: Driver;

  protected _logger: Logger;

  constructor(driver: Driver) {
    this.driver = driver;

    this._logger = logger.child({ driver: this.driver });
    this._logger.verbose(`Initializing ${this.driver} driver`);
  }

  /**
   * Initializes the driver and runs any necessary setup.
   * @abstract
   */
  abstract init(): MaybePromise<void>;

  /**
   * Returns a `cache entry` or `null` for the given identifier.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Identifier} identifier - The cache identifier.
   * @param {Policy} policy - The eviction policy the entry uses.
   * @returns {MaybePromise<Cache<T> | null>} The cache entry or null.
   */
  abstract get<T>(identifier: Identifier, policy: Policy): MaybePromise<Cache<T> | null>;

  /**
   * Sets a new cache entry. If the entry with the given identifier already exists, this method is a
   * no-op. This can be changed by setting `force` to true, which will overwrite the existing entry.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Identifier} identifier - The cache identifier.
   * @param {Policy} policy - The eviction policy the entry uses.
   * @param {boolean} [force] - Whether to overwrite existing entries.
   * @returns {MaybePromise<boolean>} `true` if the entry has been set, `false` if it has been skipped.
   */
  abstract set<T>(
    identifier: Identifier,
    policy: Policy,
    partialCache: CreateCache<T>,
    force?: boolean,
  ): MaybePromise<boolean>;

  /**
   * Invalidates all entries which have defined the given invalidation identifiers.
   * @abstract
   * @param {Identifier[]} identifier - The invalidation identifiers.
   * @param {Policy} policy - The eviction policy the entry uses.
   */
  abstract invalidate(identifier: Identifier[], policy: Policy): MaybePromise<void>;

  /**
   * Returns the current resource usage of the driver. This includes the number of used bytes
   * and a percentage of the used cache size.
   * @abstract
   * @returns {MaybePromise<[number, number]> | [number, number]} The number of used bytes and the percentage
   * of the used cache size.
   */
  abstract resourceUsage(): MaybePromise<[number, number, number]>;

  /**
   * Checks if the given cache can be inserted without overstepping the defined maximum cache size. If not
   * enough space is left over, it attempts to evict caches from the defined policy. If no caches can be
   * evicted from the defined policy either, caches from other policies will be evicted.
   * @abstract
   * @protected
   * @template T - The expected type of the cache data.
   * @throws {CacheTooBigError} If the cache is bigger than the maximum cache size.
   * @throws {NoCachesToEvictError} If no more caches can be evicted from the current policy. Only is thrown
   *  if `evictFromOthers` is set to `false`.
   * @param {Policy} policy - The policy to evict caches from first.
   * @param {Cache<T>} cache - The cache to insert.
   */
  protected abstract _ensureCacheSizeLimit<T>(policy: Policy, cache: Cache<T>): MaybePromise<void>;

  /**
   * Returns the current size of all caches combined.
   * @returns {MaybePromise<number>} The size of all caches combined.
   */
  protected abstract _getCurrentCacheSize(): MaybePromise<number>;
}
