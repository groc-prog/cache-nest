import { merge } from 'lodash-es';

import { Driver, Policy, type Cache } from '@cache-nest/types';

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

interface LRUSnapshot {
  mostRecentlyUsed: Node | null;
  leastRecentlyUsed: Node | null;
  keyMap: Map<string, Node>;
}

export class LRUPolicy extends BasePolicy {
  private _mostRecentlyUsed: Node | null = null;

  private _leastRecentlyUsed: Node | null = null;

  private _cacheKeyMap: Map<string, Node> = new Map();

  constructor(driver: Driver) {
    super(Policy.LRU, driver);

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

        // Update most/least recently used nodes and hash map
        // If no most recently used node is defined, the current entry is the first, else we update the linked list
        // and then set the new node as the least recently used node since it has never been accessed
        const node = new Node(hash);
        if (this._leastRecentlyUsed !== null) {
          this._logger.debug('Updating least recently used node');
          this._leastRecentlyUsed.prev = node;
          node.next = this._leastRecentlyUsed;
        }

        this._logger.debug('Setting least recently used node to new node');
        this._leastRecentlyUsed = node;
        if (this._mostRecentlyUsed === null) this._mostRecentlyUsed = node;

        // Update the hash-node mapping an emit a `set` event
        this._cacheKeyMap.set(hash, node);
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

        // Shift all nodes connected to the node with the given hash
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

        span.end();
      },
    );
  }

  hit<T>(cache: Cache<T>): Cache<T> {
    return tracer.startActiveSpan(
      'HitCache',
      {
        attributes: {
          'cache.driver': this.driver,
          'cache.policy': this.policy,
        },
      },
      (span) => {
        const hash = this.generateHash(cache.identifier);
        this._logger.verbose(`Increasing hit count for cache ${hash}`);
        span.setAttribute('cache.hash', hash);

        const node = this._cacheKeyMap.get(hash);
        if (node !== undefined && node.key !== this._mostRecentlyUsed?.key) {
          this._logger.debug('Updating linked list for cache nodes');

          // Remove node from linked list and insert it back at the mostRecentlyUsed position
          if (node.next !== null) node.next.prev = node.prev;
          if (node.prev !== null) node.prev.next = node.next;

          // Update least recently used node to the next node in linked list if the current node
          // is the least recently used node
          if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;

          // Set the current node as the most recently used node and update the previously most
          // recently used node if nessecarry
          this._logger.debug('Updating most recently used node');
          if (this._mostRecentlyUsed !== null) {
            this._mostRecentlyUsed.next = node;
            node.prev = this._mostRecentlyUsed;
          }
          this._mostRecentlyUsed = node;
          this._mostRecentlyUsed.next = null;
        }

        const updatedCache = merge({}, cache, {
          atime: Date.now(),
          hits: cache.hits + 1,
        });

        span.end();
        return updatedCache;
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
        // If the least recently used node is null, we can't evict anything.
        if (this._leastRecentlyUsed === null) {
          this._logger.warn('No caches to evict');
          span.end();
          return null;
        }

        const hashToEvict = this._leastRecentlyUsed.key;
        this._logger.verbose(`Stopping tracking of cache ${hashToEvict}`);
        const newLeastRecentlyUsedNode = this._leastRecentlyUsed.next;

        this._logger.debug('Deleting cache and cleaning up TTL and invalidation identifiers');
        this.clearTTL(hashToEvict);
        this._cacheKeyMap.delete(hashToEvict);

        // Update the linked list and hash map
        if (newLeastRecentlyUsedNode !== null) {
          this._logger.debug('Updating least recently used node');
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
        const snapshot = {
          mostRecentlyUsed: this._mostRecentlyUsed,
          leastRecentlyUsed: this._leastRecentlyUsed,
          keyMap: this._cacheKeyMap,
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
        const { mostRecentlyUsed, leastRecentlyUsed, keyMap } = snapshot as LRUSnapshot;

        this._mostRecentlyUsed = mostRecentlyUsed;
        this._leastRecentlyUsed = leastRecentlyUsed;
        this._cacheKeyMap = keyMap;

        for (const hash in this._cacheKeyMap) {
          if (!hashes.has(hash)) this.stopTracking(hash);
        }

        span.end();
      },
    );
  }
}
