import EventEmitter from 'events';
import { merge } from 'lodash-es';
import objectHash from 'object-hash';
import type { Logger } from 'winston';

import type { Driver, Policy, Identifier, Cache } from '@cache-nest/types';

import type { CreateCache } from '@/types/cache';
import logger from '@/utils/logger';
import { createdCachesCounter, totalEvictionsCounter, tracer, ttlEvictionsCounter } from '@/utils/opentelemetry';

interface Events {
  ttlExpired: (hash: string) => void;
}

export abstract class BasePolicy extends EventEmitter {
  policy: Policy;

  driver: Driver;

  protected _logger: Logger;

  protected _ttlMap: Map<string, NodeJS.Timer> = new Map();

  constructor(policy: Policy, driver: Driver) {
    super();

    this.policy = policy;
    this.driver = driver;
    this._logger = logger.child({ driver: this.driver, policy: this.policy });
    this._logger.verbose(`Initialized ${this.policy} policy`);
  }

  /**
   * Starts tracking a new hash.
   * @abstract
   * @param {string} hash - The hash to track.
   */
  abstract track(hash: string): void;

  /**
   * Stops tracking an existing hash.
   * @abstract
   * @param {string} hash - The hash to track.
   */
  abstract stopTracking(hash: string): void;

  /**
   * Updates the hit count and access time of a cache entry. If the cache entry is not found, a cache
   * miss is recorded.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Cache<T>} cache - The cache to hit.
   * @returns {Cache<T>} The updated cache entry.
   */
  abstract hit<T>(cache: Cache<T>): Cache<T>;

  /**
   * Evicts all caches matching the given invalidation identifier.
   * @abstract
   * @returns {string | null} The evicted hash or null if non got evicted.
   */
  abstract evict(): string | null;

  emit<T extends keyof Events>(event: T, ...args: Parameters<Events[T]>) {
    return super.emit(event, ...args);
  }

  on<T extends keyof Events>(event: T, listener: Events[T]) {
    return super.on(event, listener);
  }

  /**
   * Creates a new cache with a newly generated identifier.
   * @abstract
   * @template T - The expected type of the cache data.
   * @param {Identifier} identifier - The cache identifier.
   * @param {CreateCache<T>} partialCache - The cache to set.
   * @returns {MaybePromise<Cache<T>>} The cache.
   */
  generateCache<T>(identifier: Identifier, partialCache: CreateCache<T>): Cache<T> {
    return tracer.startActiveSpan(
      'GenerateCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
        },
      },
      (span) => {
        this._logger.verbose('Generating new cache');
        const hash = this.generateHash(identifier);
        span.setAttribute('cache.hash', hash);

        const timestamp = Date.now();
        const cache: Cache<T> = merge(
          {},
          {
            identifier,
            hits: 0,
            ctime: timestamp,
            atime: timestamp,
            options: {
              ttl: 0,
              invalidatedBy: [],
            },
          },
          partialCache,
        );
        createdCachesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': this.policy, 'cache.hash': hash });

        if (cache.options.ttl > 0) this.registerTTL(hash, cache.options.ttl);

        span.end();
        return cache;
      },
    );
  }

  /**
   * Clears any existing TTL timers.
   * @param {string} hash - Hash to register the TTL for.
   */
  clearTTL(hash: string): void {
    tracer.startActiveSpan(
      `ClearTTL`,
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'cache.hash': hash,
        },
      },
      (span) => {
        if (this._ttlMap.has(hash)) {
          this._logger.debug(`Clearing TTL for hash ${hash}`);
          clearTimeout(this._ttlMap.get(hash));
          this._ttlMap.delete(hash);
        }

        span.end();
      },
    );
  }

  /**
   * Registers TTL for the given hash. If a TTL for the given hash already exists, it is reset.
   * @emits BasePolicy#ttlExpired
   * @param {string} hash - Hash to register the TTL for.
   * @param {number} ttl - TTL time.
   */
  registerTTL(hash: string, ttl: number): void {
    tracer.startActiveSpan(
      `RegisterTTL`,
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'cache.hash': hash,
          'cache.ttl': ttl,
        },
      },
      (span) => {
        this.clearTTL(hash);

        this._logger.info(`Registering TTL for hash ${hash} with ${ttl}`);
        this._ttlMap.set(
          hash,
          setTimeout(async () => {
            tracer.startActiveSpan(
              'Evict',
              {
                root: true,
                attributes: {
                  'cache.driver': this.driver,
                  'cache.policy': this.policy,
                  'cache.hash': hash,
                  'eviction.cause': 'TTL',
                },
              },
              (evictionSpan) => {
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

                this._logger.info(`TTL for hash ${hash} expired`);
                this._ttlMap.delete(hash);

                /**
                 * @event BasePolicy#ttlExpired
                 * @type {string}
                 * @property {string} hash - The hash of the expired cache.
                 */
                this.emit('ttlExpired', hash);
                evictionSpan.end();
              },
            );
          }, ttl),
        );
        span.end();
      },
    );
  }

  /**
   * Generates a hash based on the given identifier. To prevent duplicates between cache and
   * invalidation hashes, cache hashes are prefixed with a `c`, while invalidation
   * hashes use a `i`.
   * @param {Identifier} identifier - The cache identifier.
   * @param {boolean} [isCacheHash=true] - Whether to generate a cache or invalidation identifier.
   * @returns {string} The generated hash.
   */
  generateHash(identifier: Identifier, isCacheHash: boolean = true): string {
    this._logger.debug(`Generating hash for ${isCacheHash ? 'cache' : 'invalidator'}`);
    return `${isCacheHash ? 'c' : 'i'}.${objectHash(identifier)}`;
  }
}
