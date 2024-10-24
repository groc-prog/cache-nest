import type { MaybePromise } from 'elysia';
import type { Logger } from 'winston';

import type { Cache, Driver, Policy, Identifier, DriverResourceUsage } from '@cache-nest/types';

import type { CreateCache } from '@/types/cache';
import logger from '@/utils/logger';

export abstract class BaseDriver {
  driver: Driver;

  protected _logger: Logger;

  constructor(driver: Driver) {
    this.driver = driver;

    this._logger = logger.child({ driver: this.driver });
  }

  /**
   * Initializes the driver and runs any necessary setup.
   * @abstract
   */
  abstract init(): MaybePromise<void>;

  /**
   * Returns a `cache entry` or `null` if no cache exists for the given identifier.
   * @abstract
   * @param {Identifier} identifier - The cache identifier.
   * @param {Policy} policy - The eviction policy the entry uses.
   * @returns {MaybePromise<Cache | null>} The cache entry or null.
   */
  abstract get(identifier: Identifier, policy: Policy): MaybePromise<Cache | null>;

  /**
   * Sets a new cache entry. If the entry with the given identifier already exists, this method is a
   * no-op. This can be changed by setting `force` to `true`, which will overwrite the existing entry.
   * @abstract
   * @param {Identifier} identifier - The cache identifier.
   * @param {Policy} policy - The eviction policy the entry uses.
   * @param {boolean} [force] - Whether to overwrite existing entries.
   * @returns {MaybePromise<boolean>} `true` if the entry has been set, `false` if it has been skipped.
   */
  abstract set(
    identifier: Identifier,
    policy: Policy,
    partialCache: CreateCache,
    force?: boolean,
  ): MaybePromise<boolean>;

  /**
   * Deletes a cache by it's identifier. In contrast to te `invalidate` method, this one only affects the
   * defined cache and no other caches.
   * @abstract
   * @param {Identifier} identifier - The cache identifier.
   * @param {Policy} policy - The eviction policy the entry uses.
   */
  abstract delete(identifier: Identifier, policy: Policy): MaybePromise<void>;

  /**
   * Invalidates all entries which have defined the given invalidation identifiers.
   * @abstract
   * @param {Identifier[]} identifiers - The invalidation identifiers.
   * @param {Policy} policy - The eviction policy the entry uses.
   */
  abstract invalidate(identifiers: Identifier[], policy: Policy): MaybePromise<void>;

  /**
   * Returns the current resource usage of the driver. This includes the number of used bytes
   * and a percentage of the used cache size.
   * @abstract
   * @returns {MaybePromise<DriverResourceUsage>} The number of used bytes and the percentage
   * of the used cache size.
   */
  abstract resourceUsage(): MaybePromise<DriverResourceUsage>;
}

export abstract class NativeBaseDriver extends BaseDriver {
  /**
   * Checks if the given cache can be inserted without overstepping the defined maximum cache size. If there
   * is not enough space left over, it attempts to evict caches from the defined policy. If no caches can be
   * evicted from the defined policy either, a error will be throw. This can be changed by setting `evictFromOthers`
   * to `true`, then caches from other policies will be evicted until no more evictions can be made.
   * @abstract
   * @protected
   * @throws {ApiError} If the cache is bigger than the maximum cache size.
   * @throws {ApiError} If no more caches can be evicted from the current policy. Only is thrown
   *  if `evictFromOthers` is set to `false`.
   * @param {Policy} policy - The policy to evict caches from first.
   * @param {Cache} cache - The cache to insert.
   */
  protected abstract _ensureCacheSizeLimit(policy: Policy, cache: Cache): MaybePromise<void>;

  /**
   * Returns the current size of all caches combined.
   * @returns {MaybePromise<number>} The size of all caches combined.
   */
  protected abstract _getCurrentCacheSize(): MaybePromise<number>;
}
