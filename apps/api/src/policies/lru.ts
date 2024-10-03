import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';
import { tracer } from '@/utils/opentelemetry';

/**
 * @private
 * Internal node class used by LRU policy. Should not be used outside of tests.
 */
export class LRUNode {
  prev: LRUNode | null;

  next: LRUNode | null;

  key: string;

  constructor(key: string, prev: LRUNode | null = null, next: LRUNode | null = null) {
    this.key = key;
    this.prev = prev;
    this.next = next;
  }
}

interface LRUSnapshot {
  keyOrder: string[];
}

export class LRUPolicy extends BasePolicy {
  protected _mostRecentlyUsed: LRUNode | null = null;

  protected _leastRecentlyUsed: LRUNode | null = null;

  protected _cacheKeyMap: Map<string, LRUNode> = new Map();

  protected _keyOrder: string[] = [];

  constructor(driver: Driver) {
    super(Policy.LRU, driver);

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
        if (this._cacheKeyMap.has(hash)) {
          this._logger.warn(`Hash ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new hash ${hash}`);
        const node = new LRUNode(hash);

        this._logger.debug('Updating most recently used hash');
        if (this._mostRecentlyUsed !== null) {
          this._mostRecentlyUsed.next = node;
          node.prev = this._mostRecentlyUsed;
        }

        this._mostRecentlyUsed = node;
        if (this._leastRecentlyUsed === null) this._leastRecentlyUsed = node;

        this._cacheKeyMap.set(hash, node);
        this._keyOrder.push(node.key);
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
        const node = this._cacheKeyMap.get(hash);
        if (node === undefined) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

        this._logger.verbose(`Stop tracking hash ${hash}`);
        if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;
        if (this._mostRecentlyUsed?.key === node.key) this._mostRecentlyUsed = node.prev;
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        this._cacheKeyMap.delete(hash);
        this.clearTTL(node.key);

        const index = this._keyOrder.findIndex((key) => key === hash);
        if (index !== -1) this._keyOrder.splice(index, 1);

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
        },
      },
      (span) => {
        this._logger.verbose(`Increasing hit count for hash ${hash}`);
        span.setAttribute('cache.hash', hash);

        const node = this._cacheKeyMap.get(hash);
        if (node !== undefined && node.key !== this._mostRecentlyUsed?.key) {
          this._logger.debug('Updating linked list for hashes');

          if (node.next !== null) node.next.prev = node.prev;
          if (node.prev !== null) node.prev.next = node.next;

          if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;

          this._logger.debug('Updating most recently used hash');
          if (this._mostRecentlyUsed !== null) {
            this._mostRecentlyUsed.next = node;
            node.prev = this._mostRecentlyUsed;
          }
          this._mostRecentlyUsed = node;
          this._mostRecentlyUsed.next = null;

          if (this._keyOrder.length > 1) {
            const index = this._keyOrder.findIndex((key) => key === node.key);
            this._keyOrder.splice(index, 1);
            this._keyOrder.push(hash);
          }
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
        if (this._leastRecentlyUsed === null) {
          this._logger.warn('No caches to evict');
          span.end();
          return null;
        }

        const hashToEvict = this._leastRecentlyUsed.key;
        this._logger.verbose(`Stopping tracking of cache ${hashToEvict}`);
        const newLeastRecentlyUsedNode = this._leastRecentlyUsed.next;

        this._logger.debug('Deleting hash and cleaning up TTL and invalidation identifiers');
        this.clearTTL(hashToEvict);
        this._cacheKeyMap.delete(hashToEvict);
        this._keyOrder = this._keyOrder.filter((key) => key !== hashToEvict);

        if (newLeastRecentlyUsedNode !== null) {
          this._logger.debug('Updating least recently used hash');
          newLeastRecentlyUsedNode.prev = null;
        }
        this._leastRecentlyUsed = newLeastRecentlyUsedNode;
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

        this._keyOrder.forEach((key, index) => {
          if (!hashes.has(key)) return;

          const node = new LRUNode(key);
          const prevKey = this._keyOrder[index - 1];

          if (this._leastRecentlyUsed === null && prevKey === undefined) {
            this._leastRecentlyUsed = node;
            this._cacheKeyMap.set(key, node);
            return;
          }

          const prevNode = this._cacheKeyMap.get(prevKey!);
          if (prevNode !== undefined) {
            node.prev = prevNode;
            prevNode.next = node;
          }

          this._cacheKeyMap.set(key, node);
          if (index === this._keyOrder.length - 1) this._mostRecentlyUsed = node;
        });

        span.end();
      },
    );
  }
}
