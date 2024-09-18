import type { MaybePromise } from 'elysia';

import { Driver, EvictionPolicy, type Cache } from '@cache-nest/types';

import { BaseCachePolicy } from '@/cache-policies/base';
import { tracer } from '@/utils/opentelemetry';

class Node {
  /**
   * The previous node which has a older access time than the current node.
   */
  prev: Node | null;

  /**
   * The next node which has a newer access time than the current node.
   */
  next: Node | null;

  key: string;

  constructor(key: string, prev: Node | null = null, next: Node | null = null) {
    this.key = key;
    this.prev = prev;
    this.next = next;
  }
}

export class LRUCachePolicy extends BaseCachePolicy {
  protected _mostRecentlyUsed: Node | null = null;

  protected _leastRecentlyUsed: Node | null = null;

  protected _cacheKeyMap: Map<string, Node> = new Map();

  constructor(driver: Driver) {
    super(EvictionPolicy.LRU, driver);
  }

  startTracking<T>(cache: Cache<T>): MaybePromise<void> {
    tracer.startActiveSpan('TrackCache', (span) => {
      const hash = this._generateHash(cache.identifier);
      this._logger.verbose(`Tracking new cache ${hash}`);
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
      });

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
    });
  }

  hit<T>(cache: Cache<T>): MaybePromise<void> {
    tracer.startActiveSpan('HitCache', (span) => {
      const hash = this._generateHash(cache.identifier);
      this._logger.verbose(`Increasing hit count for cache ${hash}`);
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
      });

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
    });
  }

  evict<T>(cache: Cache<T>): MaybePromise<void> {
    tracer.startActiveSpan('StopTrackingCache', (span) => {
      const hash = this._generateHash(cache.identifier);
      this._logger.verbose(`Stopping tracking for cache ${hash}`);
      span.setAttributes({
        'cache.driver': this.driver,
        'cache.policy': this.policy,
        'cache.hash': hash,
      });

      // If the least recently used node is null, we can't evict anything.
      if (this._leastRecentlyUsed === null) {
        this._logger.warn('No caches to evict');
        this.emit('evictFromOther');
        span.end();
        return;
      }

      this._logger.info(`Evicting cache ${this._leastRecentlyUsed.key}`);
      const newLeastRecentlyUsedNode = this._leastRecentlyUsed.next;

      this._logger.debug('Deleting cache and cleaning up TTL and invalidation identifiers');
      if (this._ttlMap.has(this._leastRecentlyUsed.key)) clearTimeout(this._ttlMap.get(this._leastRecentlyUsed.key));
      this._cacheKeyMap.delete(this._leastRecentlyUsed.key);

      // Update the linked list and hash map
      if (newLeastRecentlyUsedNode !== null) {
        this._logger.debug('Updating least recently used node');
        span.addEvent('updatingLeastRecentlyUsedNode');
        newLeastRecentlyUsedNode.prev = null;
      }
      this._leastRecentlyUsed = newLeastRecentlyUsedNode;
    });
  }
}
