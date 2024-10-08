import { max } from 'lodash-es';

import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';
import { tracer } from '@/utils/opentelemetry';

interface MFUSnapshot {
  keyOrderMap: Map<number, string[]>;
}

export class MFUPolicy extends BasePolicy {
  protected _cacheKeyMap: Map<string, number> = new Map<string, number>();

  protected _keyOrderMap: Map<number, string[]> = new Map<number, string[]>();

  protected _highestHitCount: number = 0;

  constructor(driver: Driver) {
    super(Policy.MFU, driver);

    this.on('ttlExpired', (hash) => {
      this.stopTracking(hash);
    });
  }

  track(hash: string): void {
    tracer.startActiveSpan(
      'TrackCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'cache.hash': hash,
        },
      },
      (span) => {
        if (!this._keyOrderMap.has(0)) this._keyOrderMap.set(0, []);
        if (this._cacheKeyMap.has(hash)) {
          this._logger.warn(`Hash ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new hash ${hash}`);
        this._cacheKeyMap.set(hash, 0);
        this._keyOrderMap.get(0)!.push(hash);
        span.end();
      },
    );
  }

  stopTracking(hash: string): void {
    tracer.startActiveSpan(
      'StopTrackingCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'cache.hash': hash,
        },
      },
      (span) => {
        let hits = this._cacheKeyMap.get(hash);
        if (hits === undefined) hits = -1;

        const index = this._keyOrderMap.get(hits)?.findIndex((key) => key === hash);
        if (hits === undefined || index === -1 || index === undefined) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

        this._logger.verbose(`Stop tracking hash ${hash}`);
        this._cacheKeyMap.delete(hash);
        this._keyOrderMap.get(hits)?.splice(index, 1);
        this.clearTTL(hash);

        if (this._keyOrderMap.get(hits)?.length === 0) {
          this._keyOrderMap.delete(hits);

          if (this._highestHitCount === hits) this._highestHitCount = max(Array.from(this._keyOrderMap.keys())) || 0;
        }

        span.end();
      },
    );
  }

  hit(hash: string): void {
    tracer.startActiveSpan(
      'HitCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'cache.hash': hash,
        },
      },
      (span) => {
        let hits = this._cacheKeyMap.get(hash);
        if (hits === undefined) hits = -1;

        const index = this._keyOrderMap.get(hits)?.findIndex((key) => key === hash);
        if (index === -1 || index === undefined) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not increase hit count`);
          span.end();
          return;
        }

        const newHitCount = hits + 1;
        if (!this._keyOrderMap.has(newHitCount)) this._keyOrderMap.set(newHitCount, []);
        if (this._highestHitCount < newHitCount) this._highestHitCount = newHitCount;

        this._logger.verbose(`Increasing hit count for hash ${hash}`);
        this._cacheKeyMap.set(hash, newHitCount);
        this._keyOrderMap.get(hits)!.splice(index, 1);
        this._keyOrderMap.get(newHitCount)!.push(hash);

        span.end();
      },
    );
  }

  evict(): string | null {
    return tracer.startActiveSpan(
      'Evict',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
          'eviction.cause': 'size',
        },
      },
      (span) => {
        const hash = this._keyOrderMap.get(this._highestHitCount)?.pop();
        if (hash === undefined) {
          span.end();
          return null;
        }

        this._cacheKeyMap.delete(hash);
        this.clearTTL(hash);

        if (this._keyOrderMap.get(this._highestHitCount)?.length === 0) {
          this._keyOrderMap.delete(this._highestHitCount);

          this._highestHitCount = max(Array.from(this._keyOrderMap.keys())) || 0;
        }

        span.end();
        return hash;
      },
    );
  }

  getSnapshot(): unknown {
    return tracer.startActiveSpan(
      'GetSnapshot',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
        },
      },
      (span) => {
        this._logger.verbose(`Generating ${this.policy} snapshot`);
        const snapshot: MFUSnapshot = {
          keyOrderMap: this._keyOrderMap,
        };

        span.end();
        return snapshot;
      },
    );
  }

  applySnapshot(hashes: Set<string>, { keyOrderMap }: MFUSnapshot): void {
    tracer.startActiveSpan(
      'ApplySnapshot',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
        },
      },
      (span) => {
        this._logger.info(`Applying ${this.policy} snapshot`);
        for (const [hits, hitHashes] of keyOrderMap.entries()) {
          const validHashes = hitHashes.filter((hash) => hashes.has(hash));

          if (hits > this._highestHitCount) this._highestHitCount = hits;
          if (!this._keyOrderMap.has(hits)) this._keyOrderMap.set(hits, validHashes);

          for (const hash of validHashes) {
            this._cacheKeyMap.set(hash, hits);
          }
        }

        span.end();
      },
    );
  }
}
