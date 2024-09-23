import { Mutex } from 'async-mutex';
import type { MaybePromise } from 'elysia';
import { isNumber, parseInt } from 'lodash-es';
import os from 'os';

import { Driver, type Cache, type Policy, type Identifier } from '@cache-nest/types';

import { BaseDriver } from '@/drivers/base';
import type { BasePolicy } from '@/policies/base';
import { LRUPolicy } from '@/policies/lru';
import type { CreateCache } from '@/types/cache';
import type { ApiConfiguration } from '@/types/configuration';
import { CacheTooBigError, NoCachesToEvictError } from '@/utils/errors';
import { cacheLookupsCounter, cacheMissesCounter, tracer } from '@/utils/opentelemetry';

export class MemoryDriver extends BaseDriver {
  // @ts-expect-error
  private _caches: Record<Policy, Map<string, Cache>> = {
    LRU: new Map(),
  };

  // @ts-expect-error
  private _policies: Record<Policy, BasePolicy> = {
    LRU: new LRUPolicy(Driver.MEMORY),
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

      for (const policy in this._policies) {
        this._logger.verbose(`Setting up listeners for ${policy} policy`);
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
      await this._policies[policy].track<T>(cache);
      this._caches[policy].set(hash, cache);

      span.end();
      return true;
    });
  }

  invalidate(identifier: Identifier[], policy: Policy): MaybePromise<void> {}

  resourceUsage(): MaybePromise<[number, number, number]> {}

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
        'cache.priority': policy,
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

      while (this._getCurrentCacheSize() > currentMaxSize) {
        hashToEvict = await this._policies[policy].evict();

        if (hashToEvict === null) break;
        else {
          this._logger.info(`Evicting cache ${hashToEvict} from policy ${policy}`);
          this._caches[policy].delete(hashToEvict);
        }
      }

      if (hashToEvict !== null) return;
      if (hashToEvict === null && !this._config.evictFromOthers) throw new NoCachesToEvictError();

      // If all caches from policy have been evicted, but the cache still does not fit, we attempt
      // to evict caches from other policies to make space
      const remainingPolicies = Object.keys(this._policies).filter((policyToCheck) => policyToCheck !== policy);
      for (const remainingPolicy in remainingPolicies) {
        while (this._getCurrentCacheSize() > currentMaxSize) {
          hashToEvict = await this._policies[remainingPolicy as Policy].evict();

          if (hashToEvict === null) break;
          else {
            this._logger.info(`Evicting cache ${hashToEvict} from policy ${remainingPolicies}`);
            this._caches[remainingPolicy as Policy].delete(hashToEvict);
          }
        }

        if (hashToEvict !== null) return;
      }

      if (hashToEvict === null) throw new NoCachesToEvictError();
    });
  }
}
