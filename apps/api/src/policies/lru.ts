import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';
import { LinkedList } from '@/utils/linked-list';
import { tracer } from '@/utils/opentelemetry';

interface LRUSnapshot {
  keyOrder: string[];
}

export class LRUPolicy extends BasePolicy {
  protected _keyOrder: string[] = [];

  protected _linkedList: LinkedList;

  constructor(driver: Driver) {
    super(Policy.LRU, driver);

    this._linkedList = new LinkedList(this._logger);

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
        const added = this._linkedList.add(hash);
        if (!added) {
          this._logger.warn(`Hash ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new hash ${hash}`);
        this._keyOrder.push(hash);
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
        const removed = this._linkedList.remove(hash);
        if (!removed) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

        this._logger.verbose(`Stop tracking hash ${hash}`);
        this.clearTTL(hash);

        const index = this._keyOrder.findIndex((key) => key === hash);
        if (index !== -1) this._keyOrder.splice(index, 1);
        else
          this._logger.warn(
            `Hash ${hash} is only partially tracked. If you see this in production, please open a issue at https://github.com/groc-prog/cache-nest`,
          );

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
        const promoted = this._linkedList.promote(hash);
        if (!promoted) {
          this._logger.verbose(`Hash ${hash} is not being tracked or already the most used, skipping`);
          span.end();
          return;
        }

        this._logger.verbose(`Increasing hit count for hash ${hash}`);
        if (this._keyOrder.length > 1) {
          const index = this._keyOrder.findIndex((key) => key === hash);
          this._keyOrder.splice(index, 1);
          this._keyOrder.push(hash);
        }

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
        if (this._linkedList.leastRecentlyUsed === null) {
          span.end();
          return null;
        }

        const hashToEvict = this._linkedList.leastRecentlyUsed.key;
        this._logger.verbose(`Stopping tracking of cache ${hashToEvict}`);
        this._linkedList.remove(this._linkedList.leastRecentlyUsed.key);

        this._logger.debug('Deleting hash and cleaning up TTL and invalidation identifiers');
        this.clearTTL(hashToEvict);
        this._keyOrder = this._keyOrder.filter((key) => key !== hashToEvict);

        span.end();
        return hashToEvict;
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
        const snapshot: LRUSnapshot = {
          keyOrder: this._keyOrder,
        };

        span.end();
        return snapshot;
      },
    );
  }

  applySnapshot(hashes: Set<string>, { keyOrder }: LRUSnapshot): void {
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
        this._keyOrder = keyOrder.filter((key) => hashes.has(key));

        for (const key of this._keyOrder) {
          if (!hashes.has(key)) continue;

          this._linkedList.add(key);
        }

        span.end();
      },
    );
  }
}
