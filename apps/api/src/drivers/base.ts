import type { MaybePromise } from 'elysia';

import type { Cache, EvictionPolicy, Identifier } from '@cache-nest/types';

export abstract class BaseDriver {
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
   * @param {EvictionPolicy} policy - The eviction policy the entry uses.
   * @returns {MaybePromise<Cache<T> | null>} The cache entry or null.
   */
  abstract get<T>(identifier: Identifier, policy: EvictionPolicy): MaybePromise<Cache<T> | null>;

  /**
   * Sets a new cache entry. If the entry with the given identifier already exists, this method is a
   * no-op. This can be changed by setting `force` to true, which will overwrite the existing entry.
   * @abstract
   * @param {Identifier} identifier - The cache identifier.
   * @param {EvictionPolicy} policy - The eviction policy the entry uses.
   * @param {boolean} [force] - Whether to overwrite existing entries.
   * @returns {MaybePromise<boolean>} `true` if the entry has been set, `false` if it has been skipped.
   */
  abstract set(identifier: Identifier, policy: EvictionPolicy, force?: boolean): MaybePromise<boolean>;

  /**
   * Invalidates all entries which have defined the given invalidation identifiers.
   * @abstract
   * @param {Identifier[]} identifier - The invalidation identifiers.
   * @param {EvictionPolicy} policy - The eviction policy the entry uses.
   */
  abstract invalidate(identifier: Identifier[], policy: EvictionPolicy): MaybePromise<void>;

  /**
   * Returns the current resource usage of the driver. This includes the number of used bytes
   * and a percentage of the used cache size.
   * @abstract
   * @returns {MaybePromise<[number, number]> | [number, number]} The number of used bytes and the percentage
   * of the used cache size.
   */
  abstract resourceUsage(): MaybePromise<[number, number, number]>;
}
