import { encode, decode } from '@msgpack/msgpack';
import { Mutex } from 'async-mutex';
import fse from 'fs-extra';
import { capitalize, lowerCase, merge } from 'lodash-es';
import path from 'path';

import {
  Driver,
  Policy,
  type Cache,
  type DeepPartial,
  type DriverResourceUsage,
  type Identifier,
  type ApiConfiguration,
} from '@cache-nest/types';

import { BaseDriver } from '@/drivers/base';
import type { BasePolicy } from '@/policies/base';
import { FIFOPolicy } from '@/policies/fifo';
import { LFUPolicy } from '@/policies/lfu';
import { LRUPolicy } from '@/policies/lru';
import { MFUPolicy } from '@/policies/mfu';
import { MRUPolicy } from '@/policies/mru';
import { RRPolicy } from '@/policies/rr';
import type { CreateCache } from '@/types/cache';
import { ApiError } from '@/utils/errors';
import { extensionCodec } from '@/utils/msgpack';
import {
  cacheHitsCounter,
  cacheLookupsCounter,
  cacheMissesCounter,
  invalidationEvictionsCounter,
  sizeLimitEvictionsCounter,
  totalEvictionsCounter,
  tracer,
} from '@/utils/opentelemetry';

type Snapshot = {
  caches: {
    [K in Policy]: Map<string, Cache>;
  };
  policies: {
    [K in Policy]: unknown;
  };
};

export class MemoryDriver extends BaseDriver {
  private _caches: Record<Policy, Map<string, Cache<unknown>>> = {
    [Policy.LRU]: new Map(),
    [Policy.MRU]: new Map(),
    [Policy.RR]: new Map(),
    [Policy.FIFO]: new Map(),
    [Policy.LFU]: new Map(),
    [Policy.MFU]: new Map(),
  };

  private _policies: Record<Policy, BasePolicy> = {
    [Policy.LRU]: new LRUPolicy(Driver.MEMORY),
    [Policy.MRU]: new MRUPolicy(Driver.MEMORY),
    [Policy.RR]: new RRPolicy(Driver.MEMORY),
    [Policy.FIFO]: new FIFOPolicy(Driver.MEMORY),
    [Policy.MFU]: new MFUPolicy(Driver.MEMORY),
    [Policy.LFU]: new LFUPolicy(Driver.MEMORY),
  };

  private _invalidations: Record<Policy, Map<string, Set<string>>> = {
    [Policy.LRU]: new Map(),
    [Policy.MRU]: new Map(),
    [Policy.RR]: new Map(),
    [Policy.FIFO]: new Map(),
    [Policy.MFU]: new Map(),
    [Policy.LFU]: new Map(),
  };

  private _mutexes: Record<Policy, Mutex> = {
    [Policy.LRU]: new Mutex(),
    [Policy.MRU]: new Mutex(),
    [Policy.RR]: new Mutex(),
    [Policy.FIFO]: new Mutex(),
    [Policy.MFU]: new Mutex(),
    [Policy.LFU]: new Mutex(),
  };

  private _config: ApiConfiguration['drivers']['memory'];

  constructor(config: ApiConfiguration['drivers']['memory']) {
    super(Driver.MEMORY);
    this._config = config;
  }

  async init(): Promise<void> {
    return tracer.startActiveSpan(
      'InitializeDriver',
      {
        attributes: {
          'cache.driver': this.driver,
        },
      },
      async (span) => {
        this._logger.info(`Initializing ${this.driver} driver`);

        for (const policy in this._policies) {
          this._logger.debug(`Setting up listeners for ${policy} policy`);
          this._policies[policy as Policy].on('ttlExpired', (hash) => {
            this._caches[policy as Policy].delete(hash);
          });
        }

        if (this._config.recovery.enabled) await this._initSnapshots();

        this._logger.info(`${capitalize(this.driver)} driver initialized`);
        span.end();
      },
    );
  }

  async get<T>(identifier: Identifier, policy: Policy): Promise<Cache<T> | null> {
    return tracer.startActiveSpan(
      'GetCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        const hash = this._policies[policy].generateHash(identifier);
        cacheLookupsCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
        span.setAttribute('cache.hash', hash);

        this._logger.info(`Getting cache for ${hash}`);
        const cache = this._caches[policy].get(hash) as Cache<T>;

        if (cache == null) {
          this._logger.info(`No cache for ${hash} found in ${policy} cache`);
          cacheMissesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
          span.end();
          return null;
        }

        this._logger.info(`Cache hit for ${hash} in ${policy} cache`);
        const updatedCache = await this._mutexes[policy].runExclusive(() => {
          this._policies[policy].hit(hash);

          const updated: Cache<T> = merge({}, cache, {
            atime: Date.now(),
            hits: cache.hits + 1,
          });
          this._caches[policy].set(hash, updated);

          return updated;
        });

        cacheHitsCounter.add(1, {
          'cache.driver': this.driver,
          'cache.policy': policy,
          'cache.hash': hash,
        });

        span.end();
        return updatedCache;
      },
    );
  }

  async set<T>(
    identifier: Identifier,
    policy: Policy,
    partialCache: CreateCache<T>,
    force?: boolean,
  ): Promise<boolean> {
    return tracer.startActiveSpan(
      'SetCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        const hash = this._policies[policy].generateHash(identifier);
        span.setAttribute('cache.hash', hash);
        this._logger.info(`Settings cache ${hash}`);

        if (this._caches[policy].has(hash) && !force) {
          this._logger.warn(`Cache ${hash} does already exist and force is set to false, skipping`);
          span.end();
          return false;
        }

        const cache = this._policies[policy].generateCache<T>(identifier, partialCache);
        await this._ensureCacheSizeLimit(policy, cache);
        this._policies[policy].track(hash);

        await this._mutexes[policy].runExclusive(() => {
          this._caches[policy].set(hash, cache);

          if (cache.options.invalidatedBy.length > 0) {
            this._logger.verbose(
              `Registering ${cache.options.invalidatedBy.length} invalidation identifiers for ${hash}`,
            );
            cache.options.invalidatedBy
              .map((invalidationIdentifier) => this._policies[policy].generateHash(invalidationIdentifier, false))
              .forEach((invalidationHash) => {
                if (!this._invalidations[policy].has(invalidationHash))
                  this._invalidations[policy].set(invalidationHash, new Set());
                this._invalidations[policy].get(invalidationHash)?.add(hash);
              });
          }
        });

        span.end();
        return true;
      },
    );
  }

  async invalidate(identifiers: Identifier[], policy: Policy): Promise<void> {
    tracer.startActiveSpan(
      'InvalidateCaches',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        this._logger.info(`Evicting all caches affected by ${identifiers.length} invalidation identifiers`);

        for (const identifier of identifiers) {
          await tracer.startActiveSpan(
            'InvalidateCache',
            { attributes: { 'cache.driver': this.driver, 'cache.policy': policy } },
            async (invalidateCacheSpan) => {
              const hash = this._policies[policy].generateHash(identifier, false);
              const affectedCaches = this._invalidations[policy].get(hash);

              if (affectedCaches === undefined || affectedCaches.size === 0)
                this._logger.verbose(`No caches to evict for identifier ${hash}`);
              else this._logger.verbose(`Evicting ${affectedCaches.size} caches for identifier ${hash}`);

              invalidateCacheSpan.setAttributes({
                'cache.affected': affectedCaches?.size || 0,
                'invalidator.hash': hash,
              });

              await this._mutexes[policy].runExclusive(() => {
                affectedCaches?.forEach((cacheHash) => {
                  this._logger.debug(`Evicting cache ${cacheHash}`);
                  this._policies[policy].stopTracking(cacheHash);
                  this._caches[policy].delete(cacheHash);
                });

                this._invalidations[policy].delete(hash);
              });

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
              invalidateCacheSpan.end();
            },
          );
        }

        span.end();
      },
    );
  }

  resourceUsage(): DriverResourceUsage {
    return tracer.startActiveSpan('ResourceUsage', { attributes: { 'cache.driver': this.driver } }, (span) => {
      const totalRelative = (this._getCurrentCacheSize() * 100) / this._config.maxSize;

      const resourceUsage = Object.keys(this._caches).reduce(
        (obj, policy) => {
          const size = Buffer.byteLength(JSON.stringify([...this._caches[policy as Policy].values()]));
          const relativeSize = (size * 100) / this._config.maxSize;

          obj[lowerCase(policy) as Lowercase<Policy>] = {
            count: this._caches[policy as Policy].size,
            relative: parseFloat(relativeSize.toFixed(6)),
            total: size,
          };

          return obj;
        },
        {
          total: this._getCurrentCacheSize(),
          relative: parseFloat(totalRelative.toFixed(6)),
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
    return tracer.startActiveSpan(
      'EnsureCacheSizeLimit',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        this._logger.verbose('Ensuring cache size limits');

        const cacheSize = Buffer.byteLength(JSON.stringify(cache));
        if (cacheSize > this._config.maxSize)
          throw new ApiError({ message: 'Cache too big', detail: 'Cache size exceeds maximum', status: 409 });

        const currentMaxSize = this._config.maxSize - cacheSize;
        if (this._getCurrentCacheSize() <= currentMaxSize) {
          this._logger.info('No caches have to be evicted, skipping');
          span.end();
          return;
        }

        this._logger.info('Evicting caches to ensure cache size limits');
        let hashToEvict = await this._mutexes[policy].runExclusive(() => {
          let hash: string | null = null;

          while (this._getCurrentCacheSize() > currentMaxSize) {
            hash = this._policies[policy].evict();

            if (hash === null) break;
            else {
              this._logger.verbose(`Evicting cache ${hash} from policy ${policy}`);

              this._caches[policy].delete(hash);
              totalEvictionsCounter.add(1, {
                'cache.driver': this.driver,
                'cache.policy': policy,
                'cache.hash': hash,
              });
              sizeLimitEvictionsCounter.add(1, {
                'cache.driver': this.driver,
                'cache.policy': policy,
                'cache.hash': hash,
              });
            }
          }

          return hash;
        });

        if (hashToEvict !== null) return;
        if (hashToEvict === null && !this._config.evictFromOthers) {
          this._logger.warn(`Policy ${policy} can not evict any caches`);
          throw new ApiError({
            message: 'No caches to evict',
            detail:
              'Can not evict any more caches for new cache. You can change this behavior by enabling the `evictFromOthers` option',
            status: 409,
          });
        }

        // If all caches from policy have been evicted, but the cache still does not fit, we attempt
        // to evict caches from other policies to make space
        const remainingPolicies = Object.keys(this._policies).filter((policyToCheck) => policyToCheck !== policy);
        for (const remainingPolicy of remainingPolicies) {
          this._logger.debug(`Attempting to evict caches from ${remainingPolicy} policy`);
          hashToEvict = await this._mutexes[remainingPolicy as Policy].runExclusive(() => {
            let hash: string | null = null;

            while (this._getCurrentCacheSize() > currentMaxSize) {
              hash = this._policies[remainingPolicy as Policy].evict();

              if (hash === null) break;
              else {
                this._logger.verbose(`Evicting cache ${hash} from policy ${remainingPolicies}`);
                this._caches[remainingPolicy as Policy].delete(hash);
                totalEvictionsCounter.add(1, {
                  'cache.driver': this.driver,
                  'cache.policy': remainingPolicy,
                  'cache.hash': hash,
                });
                sizeLimitEvictionsCounter.add(1, {
                  'cache.driver': this.driver,
                  'cache.policy': remainingPolicy,
                  'cache.hash': hash,
                });
              }
            }

            return hash;
          });

          if (hashToEvict !== null) {
            span.end();
            return;
          }
        }

        this._logger.error(`Failed to evict any caches from all policies, size limit check failed`);
        if (hashToEvict === null)
          throw new ApiError({
            message: 'No caches to evict',
            detail:
              'Can not evict any more caches for new cache. You can change this behavior by enabling the `evictFromOthers` option',
            status: 409,
          });
      },
    );
  }

  protected async _initSnapshots(): Promise<void> {
    return tracer.startActiveSpan(
      'InitializeSnapshots',
      {
        attributes: {
          'cache.driver': this.driver,
        },
      },
      async (span) => {
        this._logger.info('Initializing snapshots');

        const absolutePath = path.resolve(this._config.recovery.snapshotFilePath);
        const exists = await fse.exists(absolutePath);

        if (!exists) {
          try {
            this._logger.verbose('Ensuring snapshot file exists');
            await fse.ensureFile(path.resolve(this._config.recovery.snapshotFilePath));
          } catch (err) {
            this._logger.error(`Failed to create snapshot file at ${absolutePath}: `, err);
          }
        }

        await tracer.startActiveSpan(
          'RecoverSnapshots',
          {
            attributes: {
              'cache.driver': this.driver,
            },
          },
          async (recoverSnapshotsSpan) => {
            const recovered = {
              total: 0,
              [Policy.LRU]: 0,
              [Policy.LFU]: 0,
              [Policy.MRU]: 0,
              [Policy.MFU]: 0,
              [Policy.RR]: 0,
              [Policy.FIFO]: 0,
            };

            try {
              this._logger.verbose(`Loading snapshot file at ${absolutePath}`);
              let snapshotFile = await fse.readFile(path.resolve(absolutePath));
              if (snapshotFile.length === 0) {
                this._logger.verbose('No persisted caches, skipping');
                recoverSnapshotsSpan.setAttributes({
                  'recovered.total': recovered.total,
                  'recovered.lru': recovered[Policy.LRU],
                  'recovered.lfu': recovered[Policy.LFU],
                  'recovered.mru': recovered[Policy.MRU],
                  'recovered.mfu': recovered[Policy.MFU],
                  'recovered.rr': recovered[Policy.RR],
                  'recovered.fifo': recovered[Policy.FIFO],
                });
                recoverSnapshotsSpan.end();
                return;
              }

              const snapshot = decode(snapshotFile, { extensionCodec }) as Snapshot;

              for (const policy in snapshot.caches) {
                const validHashes = new Set<string>();

                for (const hash of snapshot.caches[policy as Policy].keys()) {
                  const cache = snapshot.caches[policy as Policy].get(hash);
                  if (cache === undefined) continue;

                  if (cache.options.ttl && Date.now() > cache.ctime + cache.options.ttl) {
                    this._logger.verbose(`TTL for cache ${hash} expired, not recovering cache`);
                    continue;
                  }

                  this._logger.debug(`Recovering cache ${hash}`);
                  this._caches[policy as Policy].set(hash, cache);
                  validHashes.add(hash);
                  recovered.total += 1;
                  recovered[policy as Policy] += 1;

                  if (cache.options.ttl) this._policies[policy as Policy].registerTTL(hash, cache.options.ttl);
                  if (cache.options.invalidatedBy.length > 0) {
                    this._logger.debug(
                      `Registering ${cache.options.invalidatedBy.length} invalidation identifiers for ${hash}`,
                    );
                    cache.options.invalidatedBy
                      .map((invalidationIdentifier) =>
                        this._policies[policy as Policy].generateHash(invalidationIdentifier, false),
                      )
                      .forEach((invalidationHash) => {
                        if (!this._invalidations[policy as Policy].has(invalidationHash))
                          this._invalidations[policy as Policy].set(invalidationHash, new Set());
                        this._invalidations[policy as Policy].get(invalidationHash)?.add(hash);
                      });
                  }
                }

                this._policies[policy as Policy].applySnapshot(validHashes, snapshot.policies[policy as Policy]);
              }
            } catch (err) {
              this._logger.error(`Failed to apply snapshot file ${absolutePath}: `, err);
            }

            recoverSnapshotsSpan.setAttributes({
              'recovered.total': recovered.total,
              'recovered.lru': recovered[Policy.LRU],
              'recovered.lfu': recovered[Policy.LFU],
              'recovered.mru': recovered[Policy.MRU],
              'recovered.mfu': recovered[Policy.MFU],
              'recovered.rr': recovered[Policy.RR],
              'recovered.fifo': recovered[Policy.FIFO],
            });
            recoverSnapshotsSpan.end();
          },
        );

        this._logger.verbose(`Setting up snapshot interval`);
        setInterval(async () => {
          await tracer.startActiveSpan(
            'CreateSnapshot',
            {
              root: true,
              attributes: {
                'cache.driver': this.driver,
                'snapshot.path': absolutePath,
              },
            },
            async (snapshotSpan) => {
              try {
                this._logger.info('Creating new snapshot of caches');
                const snapshot: DeepPartial<Snapshot> = {
                  caches: this._caches,
                  policies: {},
                };

                Object.keys(this._policies).forEach((policy) => {
                  snapshot.policies![policy as Policy] = this._policies[policy as Policy].getSnapshot();
                });

                const encoded = encode(snapshot, { extensionCodec });
                await fse.writeFile(absolutePath, encoded);
                this._logger.info('Snapshot created');
              } catch (err) {
                this._logger.error(`Failed to update snapshot file ${absolutePath}: `, err);
              }

              snapshotSpan.end();
            },
          );
        }, this._config.recovery.snapshotInterval * 1000);

        span.end();
      },
    );
  }
}
