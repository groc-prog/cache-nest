import { encode, decode } from '@msgpack/msgpack';
import { Mutex } from 'async-mutex';
import checkDiskSpace from 'check-disk-space';
import fse from 'fs-extra';
import { capitalize, lowerCase, merge } from 'lodash-es';
import path from 'path';
import lockfile from 'proper-lockfile';

import {
  Driver,
  Policy,
  type Cache,
  type DriverResourceUsage,
  type Identifier,
  type ApiConfiguration,
} from '@cache-nest/types';

import { NativeBaseDriver } from '@/drivers';
import { type BasePolicy, FIFOPolicy, LFUPolicy, LRUPolicy, MFUPolicy, MRUPolicy, RRPolicy } from '@/policies';
import {
  cacheHitsCounter,
  cacheLookupsCounter,
  cacheMissesCounter,
  deletedCachesCounter,
  invalidationEvictionsCounter,
  sizeLimitEvictionsCounter,
  totalEvictionsCounter,
  tracer,
} from '@/setup/opentelemetry';
import type { CreateCache } from '@/types/cache';
import { ApiError } from '@/utils/errors';
import { extensionCodec } from '@/utils/msgpack';

export class FileSystemDriver extends NativeBaseDriver {
  private _policies: Record<Policy, BasePolicy> = {
    [Policy.LRU]: new LRUPolicy(Driver.FILE_SYSTEM),
    [Policy.MRU]: new MRUPolicy(Driver.FILE_SYSTEM),
    [Policy.RR]: new RRPolicy(Driver.FILE_SYSTEM),
    [Policy.FIFO]: new FIFOPolicy(Driver.FILE_SYSTEM),
    [Policy.MFU]: new MFUPolicy(Driver.FILE_SYSTEM),
    [Policy.LFU]: new LFUPolicy(Driver.FILE_SYSTEM),
  };

  private _mutexes: Record<Policy, Mutex> = {
    [Policy.LRU]: new Mutex(),
    [Policy.MRU]: new Mutex(),
    [Policy.RR]: new Mutex(),
    [Policy.FIFO]: new Mutex(),
    [Policy.MFU]: new Mutex(),
    [Policy.LFU]: new Mutex(),
  };

  private _config: ApiConfiguration['drivers']['fileSystem'];

  constructor(config: ApiConfiguration['drivers']['fileSystem']) {
    super(Driver.FILE_SYSTEM);
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
        try {
          this._logger.info(`Initializing ${this.driver} driver`);
          await fse.ensureDir(path.resolve(this._config.mountPath));

          for (const policy in this._policies) {
            const ttlFilePath = this._ttlFilePath(policy as Policy);

            await fse.createFile(this._getInvalidationIdentifierPath(policy as Policy));
            await fse.createFile(ttlFilePath);

            await tracer.startActiveSpan(
              'RecoverTTLTimers',
              {
                attributes: {
                  'cache.driver': this.driver,
                  'cache.policy': policy,
                },
              },
              async (ttlRecoverySpan) => {
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
                  const ttlRelease = await lockfile.lock(ttlFilePath);
                  const ttlFileContent = await fse.readFile(ttlFilePath);
                  const ttlMap =
                    ttlFileContent.length === 0
                      ? new Map<string, number>()
                      : (decode(ttlFileContent, { extensionCodec }) as Map<string, number>);

                  for (const [cacheHash, timestamp] of ttlMap.entries()) {
                    if (Date.now() > timestamp) {
                      this._logger.verbose(`TTL for cache ${cacheHash} expired, not recovering cache`);
                      ttlMap.delete(cacheHash);

                      const cachePath = this._getCachePath(policy as Policy, cacheHash);
                      const cacheRelease = await lockfile.lock(cachePath);
                      await cacheRelease();
                      await fse.remove(cachePath);
                      continue;
                    }

                    this._policies[policy as Policy].registerTTL(cacheHash, timestamp - Date.now());
                    recovered[policy as Policy] += 1;
                  }

                  await fse.writeFile(ttlFilePath, encode(ttlMap, { extensionCodec }));
                  await ttlRelease();

                  ttlRecoverySpan.setAttributes({
                    'recovered.total': recovered.total,
                    'recovered.lru': recovered[Policy.LRU],
                    'recovered.lfu': recovered[Policy.LFU],
                    'recovered.mru': recovered[Policy.MRU],
                    'recovered.mfu': recovered[Policy.MFU],
                    'recovered.rr': recovered[Policy.RR],
                    'recovered.fifo': recovered[Policy.FIFO],
                  });
                  ttlRecoverySpan.end();
                } catch (err) {
                  this._logger.error('Failed to recover TTL timers', err);
                }
              },
            );

            this._logger.debug(`Setting up listeners for ${policy} policy`);
            this._policies[policy as Policy].on('ttlExpired', async (hash) => {
              try {
                const cachePath = this._getCachePath(policy as Policy, hash);

                // To assure that no other operation is currently using the file, we try to acquire a lock first
                const release = await lockfile.lock(cachePath);
                await fse.remove(cachePath);
                await release();

                this._removeTTLHash(hash, policy as Policy);
              } catch (err) {
                this._logger.error(`Failed to remove cache file for ${hash}`, err);
              }
            });
            this._policies[policy as Policy].on('ttlExpired', (hash) => {
              this._removeTTLHash(hash, policy as Policy);
            });
          }

          this._isInitialized = true;
          this._logger.info(`${capitalize(this.driver)} driver initialized`);
        } catch (err) {
          this._logger.error(`Failed to initialize ${capitalize(this.driver)} driver`, err);
        } finally {
          span.end();
        }
      },
    );
  }

  async get(identifier: Identifier, policy: Policy): Promise<Cache | null> {
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
        const cachePath = this._getCachePath(policy, hash);
        cacheLookupsCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
        span.setAttribute('cache.hash', hash);

        this._logger.info(`Getting cache ${hash}`);
        if (!(await fse.exists(cachePath))) {
          this._logger.info(`No cache ${hash} found in ${policy} cache`);
          cacheMissesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
          span.end();
          return null;
        }

        this._logger.info(`Cache hit for ${hash} in ${policy} cache`);
        cacheHitsCounter.add(1, {
          'cache.driver': this.driver,
          'cache.policy': policy,
          'cache.hash': hash,
        });

        const release = await lockfile.lock(cachePath);

        await this._mutexes[policy].runExclusive(() => {
          this._policies[policy].hit(hash);
        });

        const encodedCache = await fse.readFile(cachePath);
        if (encodedCache.length === 0)
          throw new ApiError({
            message: 'Cache not found',
            detail: `No cache with hash ${hash} exists.`,
            status: 404,
          });

        const cache = decode(encodedCache, { extensionCodec }) as Cache;

        const updatedCache: Cache = merge({}, cache, {
          atime: Date.now(),
          hits: cache.hits + 1,
        });

        await fse.writeFile(cachePath, encode(updatedCache, { extensionCodec }));
        await release();

        span.end();
        return updatedCache;
      },
    );
  }

  async set(identifier: Identifier, policy: Policy, partialCache: CreateCache, force?: boolean): Promise<boolean> {
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
        const cachePath = this._getCachePath(policy, hash);
        span.setAttribute('cache.hash', hash);
        this._logger.info(`Settings cache ${hash}`);

        if ((await fse.exists(cachePath)) && !force) {
          this._logger.warn(`Cache ${hash} does already exist and force is set to false, skipping`);
          span.end();
          return false;
        }

        const cache = this._policies[policy].generateCache(identifier, partialCache);
        await this._ensureCacheSizeLimit(policy, cache);

        // Since calling track for a hash which already exists does nothing, we first need to stop
        // tracking the hash, otherwise we can not reset the state for the hash inside the policy
        await this._mutexes[policy].runExclusive(() => {
          if (force) this._policies[policy].stopTracking(hash);
          this._policies[policy].track(hash);
        });

        const cacheFileRelease = await lockfile.lock(cachePath);
        await fse.writeFile(cachePath, encode(cache, { extensionCodec }));
        await cacheFileRelease();

        if (cache.options.invalidatedBy.length > 0) {
          this._logger.verbose(
            `Registering ${cache.options.invalidatedBy.length} invalidation identifiers for ${hash}`,
          );
          const invalidationIdentifiersPath = this._getInvalidationIdentifierPath(policy);

          const invalidationIdentifiersRelease = await lockfile.lock(invalidationIdentifiersPath);
          const encodedInvalidationIdentifiers = await fse.readFile(invalidationIdentifiersPath);
          const invalidationIdentifiers =
            encodedInvalidationIdentifiers.length === 0
              ? new Map<string, Set<string>>()
              : (decode(encodedInvalidationIdentifiers, {
                  extensionCodec,
                }) as Map<string, Set<string>>);

          cache.options.invalidatedBy
            .map((invalidationIdentifier) => this._policies[policy].generateHash(invalidationIdentifier, false))
            .forEach((invalidationHash) => {
              if (!invalidationIdentifiers.has(invalidationHash))
                invalidationIdentifiers.set(invalidationHash, new Set());
              invalidationIdentifiers.get(invalidationHash)?.add(hash);
            });

          await fse.writeFile(invalidationIdentifiersPath, encode(invalidationIdentifiers, { extensionCodec }));
          await invalidationIdentifiersRelease();
        }

        if (cache.options.ttl > 0) {
          const ttlFilePath = this._ttlFilePath(policy as Policy);
          const ttlRelease = await lockfile.lock(ttlFilePath);
          const encodedTtlMap = await fse.readFile(ttlFilePath);
          const ttlMap =
            encodedTtlMap.length === 0
              ? new Map<string, number>()
              : (decode(encodedTtlMap, { extensionCodec }) as Map<string, number>);

          ttlMap.set(hash, cache.ctime + cache.options.ttl);
          await fse.writeFile(ttlFilePath, encode(ttlMap, { extensionCodec }));
          await ttlRelease();
        }

        span.end();
        return true;
      },
    );
  }

  async delete(identifier: Identifier, policy: Policy): Promise<void> {
    return tracer.startActiveSpan(
      'DeleteCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        const hash = this._policies[policy].generateHash(identifier);
        span.setAttribute('cache.hash', hash);

        const cachePath = this._getCachePath(policy, hash);
        if (!(await fse.exists(cachePath))) {
          this._logger.info(`No cache ${hash} found in ${policy} cache`);
          cacheMissesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
          span.end();
          return;
        }

        deletedCachesCounter.add(1, { 'cache.driver': this.driver, 'cache.policy': policy, 'cache.hash': hash });
        this._logger.info(`Deleting cache ${hash}`);
        const release = await lockfile.lock(cachePath);

        const encodedCache = await fse.readFile(cachePath);
        if (encodedCache.length === 0)
          throw new ApiError({
            message: 'Cache not found',
            detail: `No cache with hash ${hash} exists.`,
            status: 404,
          });

        const cache = decode(encodedCache, { extensionCodec }) as Cache;
        await fse.remove(cachePath);
        await release();

        await this._mutexes[policy].runExclusive(() => {
          this._policies[policy].stopTracking(hash);
        });

        if (cache.options.invalidatedBy.length > 0) {
          this._logger.verbose('Cleaning up invalidation identifiers');
          const invalidationIdentifiersPath = this._getInvalidationIdentifierPath(policy);

          const invalidationIdentifiersRelease = await lockfile.lock(invalidationIdentifiersPath);
          const encodedInvalidationIdentifiers = await fse.readFile(invalidationIdentifiersPath);
          const invalidationIdentifiers =
            encodedInvalidationIdentifiers.length === 0
              ? new Map<string, Set<string>>()
              : (decode(encodedInvalidationIdentifiers, {
                  extensionCodec,
                }) as Map<string, Set<string>>);

          const invalidatedByHashes = cache.options.invalidatedBy.map((invalidationIdentifier) =>
            this._policies[policy].generateHash(invalidationIdentifier, false),
          );

          for (const invalidationIdentifier of invalidatedByHashes) {
            invalidationIdentifiers.get(invalidationIdentifier)?.delete(hash);
          }

          await fse.writeFile(invalidationIdentifiersPath, encode(invalidationIdentifiers, { extensionCodec }));
          await invalidationIdentifiersRelease();
        }

        span.end();
      },
    );
  }

  async invalidate(identifiers: Identifier[], policy: Policy): Promise<void> {
    return tracer.startActiveSpan(
      'InvalidateCaches',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': policy,
        },
      },
      async (span) => {
        this._logger.info(`Evicting all caches affected by ${identifiers.length} invalidation identifiers`);
        const invalidationIdentifiersPath = this._getInvalidationIdentifierPath(policy);

        const invalidationIdentifiersRelease = await lockfile.lock(invalidationIdentifiersPath);
        const encodedInvalidationIdentifiers = await fse.readFile(invalidationIdentifiersPath);
        const invalidationIdentifiers =
          encodedInvalidationIdentifiers.length === 0
            ? new Map<string, Set<string>>()
            : (decode(encodedInvalidationIdentifiers, {
                extensionCodec,
              }) as Map<string, Set<string>>);

        for (const identifier of identifiers) {
          await tracer.startActiveSpan(
            'InvalidateCache',
            { attributes: { 'cache.driver': this.driver, 'cache.policy': policy } },
            async (invalidateCacheSpan) => {
              const hash = this._policies[policy].generateHash(identifier, false);
              const affectedCaches = invalidationIdentifiers.get(hash);

              invalidateCacheSpan.setAttribute('cache.affected', affectedCaches?.size || 0);

              if (affectedCaches === undefined || affectedCaches.size === 0) {
                this._logger.verbose(`No caches to evict for identifier ${hash}`);
                invalidateCacheSpan.end();
                return;
              } else this._logger.verbose(`Evicting ${affectedCaches.size} caches for identifier ${hash}`);

              invalidateCacheSpan.setAttributes({
                'cache.affected': affectedCaches?.size || 0,
                'invalidator.hash': hash,
              });

              for (const cacheHash of affectedCaches) {
                await this._mutexes[policy].runExclusive(() => {
                  this._logger.debug(`Evicting cache ${cacheHash}`);
                  this._policies[policy].stopTracking(cacheHash);
                });

                const cachePath = this._getCachePath(policy, cacheHash);
                const release = await lockfile.lock(cachePath);
                await fse.remove(cachePath);
                await release();
              }
              invalidationIdentifiers.delete(hash);

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

        await fse.writeFile(invalidationIdentifiersPath, encode(invalidationIdentifiers, { extensionCodec }));
        await invalidationIdentifiersRelease();
        span.end();
      },
    );
  }

  async resourceUsage(): Promise<DriverResourceUsage> {
    return tracer.startActiveSpan('ResourceUsage', { attributes: { 'cache.driver': this.driver } }, async (span) => {
      const currentSize = await this._getCurrentCacheSize();
      const totalRelative = (currentSize * 100) / this._config.maxSize;

      const resourceUsage: DriverResourceUsage = Object.keys(this._policies).reduce(
        (obj, policy) => {
          obj[lowerCase(policy) as Lowercase<Policy>] = {
            count: 0,
            relative: 0,
            total: 0,
          };

          return obj;
        },
        {
          total: currentSize,
          relative: parseFloat(totalRelative.toFixed(6)),
        } as DriverResourceUsage,
      );

      for (const policy of Object.keys(this._policies)) {
        const policyPath = this._getCachePath(policy as Policy);
        const entries = await fse.readdir(policyPath);

        // We don't know if someone added additional subdirectories to the directory
        // so we check it here just to be sure
        const files = await Promise.all(
          entries.map(async (entry) => {
            const stats = await fse.stat(path.join(policyPath, entry));
            return stats.isFile();
          }),
        );

        const { free, size } = await checkDiskSpace(policyPath);
        const total = size - free;
        resourceUsage[policy as Policy] = {
          total,
          relative: (total * 100) / this._config.maxSize,
          count: files.filter((isFile) => isFile).length,
        };
      }

      span.end();
      return resourceUsage;
    });
  }

  protected async _getCurrentCacheSize(): Promise<number> {
    const { free, size } = await checkDiskSpace(path.resolve(this._config.mountPath));
    return size - free;
  }

  protected async _ensureCacheSizeLimit(policy: Policy, cache: Cache): Promise<void> {
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
        const currentCacheSize = await this._getCurrentCacheSize();

        // If the cache is bigger in size that the total available memory, there is no way for us
        // to ever store it, so we just give up
        const cacheSize = Buffer.byteLength(encode(cache, { extensionCodec }));
        if (cacheSize > this._config.maxSize)
          throw new ApiError({ message: 'Cache too big', detail: 'Cache size exceeds maximum', status: 409 });

        const currentMaxSize = this._config.maxSize - cacheSize;
        if (currentCacheSize <= currentMaxSize) {
          this._logger.info('No caches have to be evicted, skipping');
          span.end();
          return;
        }

        this._logger.info('Evicting caches to ensure cache size limits');

        let hashToEvict = await this._mutexes[policy].runExclusive(async () => {
          let hash: string | null = null;

          const invalidationIdentifiersPath = this._getInvalidationIdentifierPath(policy);
          const releaseInvalidationIdentifiers = await lockfile.lock(invalidationIdentifiersPath);
          const encodedInvalidationIdentifiers = await fse.readFile(invalidationIdentifiersPath);
          const invalidationIdentifiers =
            encodedInvalidationIdentifiers.length === 0
              ? new Map<string, Set<string>>()
              : (decode(encodedInvalidationIdentifiers, {
                  extensionCodec,
                }) as Map<string, Set<string>>);

          // Try to evict as many caches as necessary to make room for the new cache
          while (currentCacheSize > currentMaxSize) {
            hash = this._policies[policy].evict();

            if (hash === null) break;
            else {
              this._logger.verbose(`Evicting cache ${hash} from policy ${policy}`);
              const cachePath = this._getCachePath(policy, hash);

              const release = await lockfile.lock(cachePath);
              const encodedCache = await fse.readFile(cachePath);
              if (encodedCache.length === 0) {
                this._logger.warn(`No cache with hash ${hash} found, skipping eviction`);
                continue;
              }

              const decodedCache = decode(encodedCache, { extensionCodec }) as Cache;
              await fse.remove(cachePath);
              await release();

              const invalidationIdentifierHashes = decodedCache.options.invalidatedBy.map((identifier) =>
                this._policies[policy].generateHash(identifier, false),
              );

              if (invalidationIdentifierHashes.length > 0) {
                for (const invalidationIdentifier of invalidationIdentifierHashes) {
                  const affectedCaches = invalidationIdentifiers.get(invalidationIdentifier);
                  if (affectedCaches === undefined) continue;

                  affectedCaches.delete(hash);
                }
              }

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

          await fse.writeFile(invalidationIdentifiersPath, encode(invalidationIdentifiers, { extensionCodec }));
          await releaseInvalidationIdentifiers();

          return hash;
        });

        // If we have enough room for the new cache, we can stop
        // Otherwise we either throw a error or evict from other policies if allowed to
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
          hashToEvict = await this._mutexes[remainingPolicy as Policy].runExclusive(async () => {
            let hash: string | null = null;

            const invalidationIdentifiersPath = this._getInvalidationIdentifierPath(remainingPolicy as Policy);
            const releaseInvalidationIdentifiers = await lockfile.lock(invalidationIdentifiersPath);
            const encodedInvalidationIdentifiers = await fse.readFile(invalidationIdentifiersPath);
            const invalidationIdentifiers =
              encodedInvalidationIdentifiers.length === 0
                ? new Map<string, Set<string>>()
                : (decode(encodedInvalidationIdentifiers, {
                    extensionCodec,
                  }) as Map<string, Set<string>>);

            while (currentCacheSize > currentMaxSize) {
              hash = this._policies[remainingPolicy as Policy].evict();

              if (hash === null) break;
              else {
                this._logger.verbose(`Evicting cache ${hash} from policy ${remainingPolicies}`);
                const cachePath = this._getCachePath(remainingPolicy as Policy, hash);

                const release = await lockfile.lock(cachePath);
                const encodedCache = await fse.readFile(cachePath);
                if (encodedCache.length === 0) {
                  this._logger.warn(`No cache with hash ${hash} found, skipping eviction`);
                  continue;
                }

                const decodedCache = decode(encodedCache, { extensionCodec }) as Cache;
                await fse.remove(cachePath);
                await release();

                const invalidationIdentifierHashes = decodedCache.options.invalidatedBy.map((identifier) =>
                  this._policies[remainingPolicy as Policy].generateHash(identifier, false),
                );

                if (invalidationIdentifierHashes.length > 0) {
                  for (const invalidationIdentifier of invalidationIdentifierHashes) {
                    const affectedCaches = invalidationIdentifiers.get(invalidationIdentifier);
                    if (affectedCaches === undefined) continue;

                    affectedCaches.delete(hash);
                  }
                }

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

            await fse.writeFile(invalidationIdentifiersPath, encode(invalidationIdentifiers, { extensionCodec }));
            await releaseInvalidationIdentifiers();

            return hash;
          });

          if (hashToEvict !== null) {
            span.end();
            return;
          }
        }

        // If we don't have enough space at this point, we just accept that we lost and throw a error
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

  /**
   * Builds the path to the cache file or directory.
   * @private
   * @param {Policy} policy - The policy to use.
   * @param {string} [hash] - The hash of the file.
   * @returns {string} The full path to the file or directory.
   */
  private _getCachePath(policy: Policy, hash?: string): string {
    if (hash) return path.resolve(path.join(this._config.mountPath, lowerCase(policy), `${hash}.dat`));
    return path.resolve(path.join(this._config.mountPath, lowerCase(policy)));
  }

  /**
   * Builds the path to the invalidation identifiers file.
   * @private
   * @param {Policy} policy - The policy to use.
   * @returns {string} The full path to the file.
   */
  private _getInvalidationIdentifierPath(policy: Policy): string {
    return path.resolve(path.join(this._config.mountPath, lowerCase(policy), 'invalidation-identifiers.dat'));
  }

  /**
   * Builds the path the the ttl file.
   * @private
   * @param {Policy} policy - The policy to use.
   * @returns {string} The full path to the file.
   */
  private _ttlFilePath(policy: Policy): string {
    return path.resolve(path.join(this._config.mountPath, policy), 'ttl.dat');
  }

  private async _removeTTLHash(hash: string, policy: Policy): Promise<void> {
    const ttlFilePath = this._ttlFilePath(policy as Policy);
    const ttlRelease = await lockfile.lock(ttlFilePath);
    const encodedTtlMap = await fse.readFile(ttlFilePath);
    const ttlMap =
      encodedTtlMap.length === 0
        ? new Map<string, number>()
        : (decode(encodedTtlMap, { extensionCodec }) as Map<string, number>);

    ttlMap.delete(hash);
    await fse.writeFile(ttlFilePath, encode(ttlMap, { extensionCodec }));
    await ttlRelease();
  }
}
