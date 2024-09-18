import type { MaybePromise } from 'elysia';
import EventEmitter from 'events';
import { merge } from 'lodash-es';
import objectHash from 'object-hash';
import type { Logger } from 'winston';

import type { Driver, EvictionPolicy, Identifier, Cache } from '@cache-nest/types';

import type { CreateCache } from '@/types/cache';
import logger from '@/utils/logger';
import { createdCachesCounter, totalEvictionsCounter, tracer, ttlEvictionsCounter } from '@/utils/opentelemetry';

export abstract class BaseCachePolicy extends EventEmitter {
  policy: EvictionPolicy;

  driver: Driver;

  protected _logger: Logger;

  protected _ttlMap: Map<string, NodeJS.Timer> = new Map();

  constructor(policy: EvictionPolicy, driver: Driver) {
    super();

    this.policy = policy;
    this.driver = driver;
    this._logger = logger.child({ driver: this.driver, policy: this.policy });
    this._logger.verbose(`Initialized ${this.driver}/${this.policy}`);
  }

  /**
   * Starts tracking a new hash.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Cache<T>} cache - The cache to track.
   */
  abstract startTracking<T>(cache: Cache<T>): MaybePromise<void>;

  /**
   * Updates the hit count and access time of a cache entry. If the cache entry is not found, a cache
   * miss is recorded.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Cache<T>} cache - The cache to hit.
   */
  abstract hit<T>(cache: Cache<T>): MaybePromise<void>;

  /**
   * Evicts all caches matching the given invalidation identifier.
   * @abstract
   * @template T - The expected type of the cache data.
   * @emits BaseCachePolicy#evictFromOther
   * @param {Cache<T>} cache - The cache to track.
   */
  abstract evict<T>(cache: Cache<T>): MaybePromise<void>;

  /**
   * Creates a new cache with a newly generated identifier.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Identifier} identifier - The cache identifier.
   * @param {CreateCache<T>} partialCache - The cache to set.
   * @returns {MaybePromise<[string, Cache<T>]>} The cache identifier and cache.
   */
  generateCache<T>(identifier: Identifier, partialCache: CreateCache<T>): [string, Cache<T>] {
    return tracer.startActiveSpan('GenerateCache', (span) => {
      this._logger.debug('Generating new cache');
      const hash = this._generateHash(identifier);
      const cache: Cache<T> = merge(
        {},
        {
          identifier,
          hits: 0,
          ctime: Date.now(),
          atime: Date.now(),
          options: {
            ttl: 0,
            invalidatedBy: [],
          },
        },
        partialCache,
      );

      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
      });

      if (cache.options.ttl > 0) this._registerTTL(hash, cache.options.ttl);

      span.end();
      createdCachesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': this.policy, 'cache.hash': hash });
      return [hash, cache] as [string, Cache<T>];
    });
  }

  /**
   * Clears any existing TTL timers.
   * @param {string} hash - Hash to register the TTL for.
   */
  clearTTL(hash: string): void {
    tracer.startActiveSpan(`ClearTTL`, (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
      });

      if (this._ttlMap.has(hash)) {
        this._logger.verbose(`Clearing TTL for hash ${hash}`);
        clearTimeout(this._ttlMap.get(hash));
      }

      span.end();
    });
  }

  /**
   * Generates a hash based on the given identifier. To prevent duplicates between cache and
   * invalidation hashes, cache hashes are prefixed with a `c`, while invalidation
   * hashes use a `i`.
   * @protected
   * @param {Identifier} identifier - The cache identifier.
   * @param {boolean} [isCacheHash=true] - Whether to generate a cache or invalidation identifier.
   * @returns {string} The generated hash.
   */
  protected _generateHash(identifier: Identifier, isCacheHash: boolean = true): string {
    this._logger.debug(`Generating hash for ${isCacheHash ? 'cache' : 'invalidator'}`);
    return `${isCacheHash ? 'c' : 'i'}.${objectHash(identifier)}`;
  }

  /**
   * Registers TTL for the given hash. If a TTL for the given hash already exists, it is reset.
   * @protected
   * @emits BaseCachePolicy#ttlExpired
   * @param {string} hash - Hash to register the TTL for.
   * @param {number} ttl - TTL time.
   */
  protected _registerTTL(hash: string, ttl: number): void {
    tracer.startActiveSpan(`RegisterTTL`, (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
        'cache.ttl': ttl,
      });
      this.clearTTL(hash);

      this._logger.verbose(`Setting TTL for hash ${hash} to ${ttl}`);
      this._ttlMap.set(
        hash,
        setTimeout(async () => {
          tracer.startActiveSpan(`Evict`, (evictionSpan) => {
            evictionSpan.setAttributes({
              'cache.driver': this.driver,
              'cache.policy': this.policy,
              'cache.hash': hash,
              'eviction.cause': 'TTL',
            });
            totalEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': this.policy,
              'cache.hash': hash,
            });
            ttlEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': this.policy,
              'cache.hash': hash,
            });

            this._logger.info(`TTL for hash ${hash} expired, evicting cache`);
            this._ttlMap.delete(hash);

            /**
             * @event BaseCachePolicy#ttlExpired
             * @type {string}
             * @property {string} hash - The hash of the expired cache.
             */
            this.emit('ttlExpired', hash);
            evictionSpan.end();
          });
        }, ttl),
      );
      span.end();
    });
  }
}
