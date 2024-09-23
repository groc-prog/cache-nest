import { Mutex } from 'async-mutex';
import type { MaybePromise } from 'elysia';
import { isNumber, lowerCase, parseInt } from 'lodash-es';
import os from 'os';

import { Driver, Policy, type Cache, type DriverResourceUsage, type Identifier } from '@cache-nest/types';

import { BaseDriver } from '@/drivers/base';
import type { BasePolicy } from '@/policies/base';
import { LRUPolicy } from '@/policies/lru';
import type { CreateCache } from '@/types/cache';
import type { ApiConfiguration } from '@/types/configuration';
import { CacheTooBigError, NoCachesToEvictError } from '@/utils/errors';
import {
  cacheHitsCounter,
  cacheLookupsCounter,
  cacheMissesCounter,
  invalidationEvictionsCounter,
  sizeLimitEvictionsCounter,
  totalEvictionsCounter,
  tracer,
} from '@/utils/opentelemetry';

export class MemoryDriver extends BaseDriver {
  // @ts-expect-error
  private _caches: Record<Policy, Map<string, Cache>> = {
    [Policy.LRU]: new Map(),
  };

  // @ts-expect-error
  private _policies: Record<Policy, BasePolicy> = {
    [Policy.LRU]: new LRUPolicy(Driver.MEMORY),
  };

  // @ts-expect-error
  private _invalidations: Record<Policy, Map<string, Set<string>>> = {
    [Policy.LRU]: new Map(),
  };

  private _mutex = new Mutex();

  private _config: ApiConfiguration['drivers']['memory'];

  constructor(config: ApiConfiguration['drivers']['memory']) {
    super(Driver.MEMORY);
    this._config = config;
  }

  init(): MaybePromise<void> {
    tracer.startActiveSpan('InitializeDriver', (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
      });
      this._logger.info(`Initializing ${this.driver} driver`);

      for (const policy in this._policies) {
        this._logger.debug(`Setting up listeners for ${policy} policy`);
        this._policies[policy as Policy].on('ttlExpired', (hash) => {
          this._caches[policy as Policy].delete(hash);
        });
      }

      this._logger.verbose('Calculating size limits');
      if (!isNumber(this._config.maxSize)) {
        const percentage = parseInt(this._config.maxSize.replace('%', ''));
        this._config.maxSize = Math.floor((percentage / 100) * os.totalmem());
      }

      this._logger.info(`${this.driver} driver initialized`);
      span.end();
    });
  }

  async get<T>(identifier: Identifier, policy: Policy): Promise<Cache<T> | null> {
    return tracer.startActiveSpan('GetCache', async (span) => {
      const hash = this._policies[policy].generateHash(identifier);
      cacheLookupsCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': policy,
        'cache.hash': hash,
      });

      this._logger.info(`Getting cache for ${hash}`);
      const cache = this._caches[policy].get(hash);

      if (cache == null) {
        this._logger.info(`No cache for ${hash} found in ${policy} cache`);
        cacheMissesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
        span.end();
        return null;
      }

      this._logger.info(`Cache hit for ${hash} in ${policy} cache`);
      const updatedCache = await this._mutex.runExclusive(() => this._policies[policy].hit<T>(cache));
      this._caches[policy].set(hash, updatedCache);
      cacheHitsCounter.add(1, {
        'cache.driver': this.driver,
        'cache.policy': policy,
        'cache.hash': hash,
      });

      span.end();
      return updatedCache;
    });
  }

  async set<T>(
    identifier: Identifier,
    policy: Policy,
    partialCache: CreateCache<T>,
    force?: boolean,
  ): Promise<boolean> {
    return tracer.startActiveSpan('SetCache', async (span) => {
      const hash = this._policies[policy].generateHash(identifier);
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': policy,
        'cache.hash': hash,
      });
      this._logger.info(`Settings cache ${hash}`);

      if (this._caches[policy].has(hash) && !force) {
        this._logger.warn(`Cache ${hash} does already exist and force is set to false, skipping`);
        span.end();
        return false;
      }

      const cache = this._policies[policy].generateCache<T>(identifier, partialCache);
      await this._ensureCacheSizeLimit(policy, cache);
      await this._policies[policy].track(hash);
      this._caches[policy].set(hash, cache);

      if (cache.options.invalidatedBy.length > 0) {
        this._logger.verbose(`Registering ${cache.options.invalidatedBy.length} invalidation identifiers for ${hash}`);
        cache.options.invalidatedBy.forEach((invalidationIdentifier) => {
          const invalidationHash = this._policies[policy].generateHash(invalidationIdentifier, false);

          if (!this._invalidations[policy].has(invalidationHash))
            this._invalidations[policy].set(invalidationHash, new Set());
          this._invalidations[policy].get(invalidationHash)?.add(hash);
        });
      }

      span.end();
      return true;
    });
  }

  invalidate(identifiers: Identifier[], policy: Policy): MaybePromise<void> {
    tracer.startActiveSpan('InvalidateCaches', (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': policy,
      });
      this._logger.info(`Evicting all caches affected by ${identifiers.length} invalidation identifiers`);

      for (const identifier of identifiers) {
        tracer.startActiveSpan('InvalidateCache', (invalidateCacheSpan) => {
          const hash = this._policies[policy].generateHash(identifier, false);
          const affectedCaches = this._invalidations[policy].get(hash);

          if (affectedCaches === undefined || affectedCaches.size === 0)
            this._logger.verbose(`No caches to evict for identifier ${hash}`);
          else this._logger.verbose(`Evicting ${affectedCaches.size} caches for identifier ${hash}`);

          invalidateCacheSpan.setAttributes({
            'cache.driver': this.driver,
            'cache.policy': policy,
            'cache.affected': affectedCaches?.size || 0,
            'invalidator.hash': hash,
          });

          affectedCaches?.forEach((cacheHash) => {
            this._logger.debug(`Evicting cache ${cacheHash}`);
            this._policies[policy].stopTracking(cacheHash);
            this._caches[policy].delete(cacheHash);

            totalEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': policy,
              'cache.hash': hash,
            });
            invalidationEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': policy,
              'cache.hash': hash,
            });
          });

          this._invalidations[policy].delete(hash);
          invalidateCacheSpan.end();
        });
      }

      span.end();
    });
  }

  resourceUsage(): MaybePromise<DriverResourceUsage> {
    return tracer.startActiveSpan('ResourceUsage', (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
      });

      const resourceUsage = Object.keys(this._caches).reduce(
        (obj, policy) => {
          const size = Buffer.byteLength(JSON.stringify([...this._caches[policy as Policy].values()]));
          const relativeSize = (size * 100) / (this._config.maxSize as number);

          obj[lowerCase(policy) as Lowercase<Policy>] = {
            cacheCount: this._caches[policy as Policy].size,
            relativeSize: parseFloat(relativeSize.toFixed(6)),
            size,
          };

          return obj;
        },
        {
          total: this._getCurrentCacheSize(),
        } as DriverResourceUsage,
      );

      span.end();
      return resourceUsage;
    });
  }

  protected _getCurrentCacheSize(): number {
    return Object.values(this._caches).reduce((total, cacheMap) => {
      total += Buffer.byteLength(JSON.stringify([...cacheMap.values()]));
      return total;
    }, 0);
  }

  protected async _ensureCacheSizeLimit<T>(policy: Policy, cache: Cache<T>): Promise<void> {
    tracer.startActiveSpan('EnsureCacheSizeLimit', async (span) => {
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': policy,
      });
      this._logger.verbose('Ensuring cache size limits');

      const cacheSize = Buffer.byteLength(JSON.stringify(cache));
      if (cacheSize > (this._config.maxSize as number)) throw new CacheTooBigError();

      const currentMaxSize = (this._config.maxSize as number) - cacheSize;
      if (this._getCurrentCacheSize() <= currentMaxSize) {
        this._logger.info('No caches have to be evicted, skipping');
        return;
      }

      // Try to evict a cache from the defined policy
      let hashToEvict: string | null = null;

      this._logger.debug(`Attempting to evict caches from ${policy} policy`);
      while (this._getCurrentCacheSize() > currentMaxSize) {
        hashToEvict = await this._policies[policy].evict();

        if (hashToEvict === null) break;
        else {
          this._logger.verbose(`Evicting cache ${hashToEvict} from policy ${policy}`);
          this._caches[policy].delete(hashToEvict);
          totalEvictionsCounter.add(1, {
            'cache.driver': this.driver,
            'cache.policy': policy,
            'cache.hash': hashToEvict,
          });
          sizeLimitEvictionsCounter.add(1, {
            'cache.driver': this.driver,
            'cache.policy': policy,
            'cache.hash': hashToEvict,
          });
        }
      }

      if (hashToEvict !== null) return;
      if (hashToEvict === null && !this._config.evictFromOthers) {
        this._logger.warn(`Policy ${policy} can not evict any caches`);
        throw new NoCachesToEvictError();
      }

      // If all caches from policy have been evicted, but the cache still does not fit, we attempt
      // to evict caches from other policies to make space
      const remainingPolicies = Object.keys(this._policies).filter((policyToCheck) => policyToCheck !== policy);
      for (const remainingPolicy in remainingPolicies) {
        this._logger.debug(`Attempting to evict caches from ${remainingPolicy} policy`);
        while (this._getCurrentCacheSize() > currentMaxSize) {
          hashToEvict = await this._policies[remainingPolicy as Policy].evict();

          if (hashToEvict === null) break;
          else {
            this._logger.verbose(`Evicting cache ${hashToEvict} from policy ${remainingPolicies}`);
            this._caches[remainingPolicy as Policy].delete(hashToEvict);
            totalEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': remainingPolicy,
              'cache.hash': hashToEvict,
            });
            sizeLimitEvictionsCounter.add(1, {
              'cache.driver': this.driver,
              'cache.policy': remainingPolicy,
              'cache.hash': hashToEvict,
            });
          }
        }

        if (hashToEvict !== null) return;
      }

      this._logger.error(`Failed to evict any caches from all policies, size limit check failed`);
      if (hashToEvict === null) throw new NoCachesToEvictError();
    });
  }
}
