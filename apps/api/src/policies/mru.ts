import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';
import { tracer } from '@/utils/opentelemetry';

class Node {
  prev: Node | null;

  next: Node | null;

  key: string;

  constructor(key: string, prev: Node | null = null, next: Node | null = null) {
    this.key = key;
    this.prev = prev;
    this.next = next;
  }
}

interface MRUSnapshot {
  keyOrder: string[];
}

export class MRUPolicy extends BasePolicy {
  private _mostRecentlyUsed: Node | null = null;

  private _leastRecentlyUsed: Node | null = null;

  private _cacheKeyMap: Map<string, Node> = new Map();

  private _keyOrder: string[] = [];

  constructor(driver: Driver) {
    super(Policy.MRU, driver);

    this.on('ttlExpired', (hash) => {
      const node = this._cacheKeyMap.get(hash);
      if (node === undefined) return;

      if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;
      if (this._mostRecentlyUsed?.key === node.key) this._mostRecentlyUsed = node.prev;
      if (node.prev) node.prev.next = node.next;
      if (node.next) node.next.prev = node.prev;
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
          this._logger.warn(`Node ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new cache ${hash}`);
        const node = new Node(hash);

        this._logger.debug('Updating most recently used node');
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
        this._logger.verbose(`Stop tracking node ${hash}`);

        const node = this._cacheKeyMap.get(hash);
        if (node === undefined) {
          this._logger.warn(`Node ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

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
        this._logger.verbose(`Increasing hit count for cache ${hash}`);
        span.setAttribute('cache.hash', hash);

        const node = this._cacheKeyMap.get(hash);
        if (node !== undefined && node.key !== this._mostRecentlyUsed?.key) {
          this._logger.debug('Updating linked list for cache nodes');

          if (node.next !== null) node.next.prev = node.prev;
          if (node.prev !== null) node.prev.next = node.next;

          if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;

          this._logger.debug('Updating most recently used node');
          if (this._mostRecentlyUsed !== null) {
            this._mostRecentlyUsed.next = node;
            node.prev = this._mostRecentlyUsed;
          }
          this._mostRecentlyUsed = node;
          this._mostRecentlyUsed.next = null;

          if (this._keyOrder.length > 1) {
            const index = this._keyOrder.findIndex((key) => key === node.key);
            const swap = this._keyOrder[index];

            if (swap !== undefined) {
              this._keyOrder[index] = this._keyOrder[index + 1] as string;
              this._keyOrder[index + 1] = swap;
            }
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
        if (this._mostRecentlyUsed === null) {
          this._logger.warn('No caches to evict');
          span.end();
          return null;
        }

        const hashToEvict = this._mostRecentlyUsed.key;
        this._logger.verbose(`Stopping tracking of cache ${hashToEvict}`);
        const newMostRecentlyUsedNode = this._mostRecentlyUsed.next;

        this._logger.debug('Deleting cache and cleaning up TTL and invalidation identifiers');
        this.clearTTL(hashToEvict);
        this._cacheKeyMap.delete(hashToEvict);
        this._keyOrder = this._keyOrder.filter((key) => key !== hashToEvict);

        if (newMostRecentlyUsedNode !== null) {
          this._logger.debug('Updating least recently used node');
          newMostRecentlyUsedNode.prev = null;
        }
        this._mostRecentlyUsed = newMostRecentlyUsedNode;
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
        const snapshot = {
          keyOrder: this._keyOrder,
        };

        span.end();
        return snapshot;
      },
    );
  }

  applySnapshot(hashes: Set<string>, snapshot: unknown): void {
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
        const { keyOrder } = snapshot as MRUSnapshot;
        this._keyOrder = keyOrder.filter((key) => hashes.has(key));

        this._keyOrder.forEach((key, index) => {
          if (!hashes.has(key)) return;

          const node = new Node(key);
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
