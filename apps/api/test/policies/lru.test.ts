import { describe, it, expect, beforeEach, spyOn, jest } from 'bun:test';

import { Driver } from '@cache-nest/types';

import { LRUPolicy } from '@/policies/lru';
import { Node } from '@/utils/linked-list';

class TestLRUPolicy extends LRUPolicy {
  get keyOrder() {
    return this._keyOrder;
  }

  get mostRecentlyUsed() {
    return this._linkedList.mostRecentlyUsed;
  }

  get leastRecentlyUsed() {
    return this._linkedList.leastRecentlyUsed;
  }

  get nodeMap() {
    return this._linkedList.nodeMap;
  }

  setMockedKeyOrder(order: string[]) {
    this._keyOrder = order;
  }

  setMockedCacheKeyMap(map: Record<string, Node>) {
    Object.keys(map).forEach((hash) => {
      this._linkedList.nodeMap.set(hash, map[hash] as Node);
    });
  }

  setMockedNodes() {
    this._linkedList.add('i318rbr23ht2tk2');
    this._linkedList.add('kjsdu238dh9aeb2');
    this._linkedList.add('8hisa6rwe2t4n');

    this.setMockedKeyOrder(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2', '8hisa6rwe2t4n']);
  }
}

describe('LRUPolicy', () => {
  let policy: TestLRUPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new TestLRUPolicy(Driver.MEMORY);
  });

  describe('ttlExpired event', () => {
    it('should delete the hash emitted with the event', () => {
      const stopTrackingSpy = spyOn(policy, 'stopTracking');

      policy.emit('ttlExpired', 'i318rbr23ht2tk2');
      expect(stopTrackingSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');
    });
  });

  describe('.track()', () => {
    it('should register the hash with the other cache keys', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(1);
      expect(policy.nodeMap.has('i318rbr23ht2tk2'));

      let node1 = policy.nodeMap.get('i318rbr23ht2tk2');
      expect(node1?.key).toBe('i318rbr23ht2tk2');
      expect(node1?.prev).toBeNull();
      expect(node1?.next).toBeNull();
      expect(policy.mostRecentlyUsed).toEqual(node1!);
      expect(policy.leastRecentlyUsed).toEqual(node1!);
      expect(policy.keyOrder).toHaveLength(1);
      expect(policy.keyOrder).toContain('i318rbr23ht2tk2');

      policy.track('kjsdu238dh9aeb2');
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.nodeMap.has('kjsdu238dh9aeb2'));

      node1 = policy.nodeMap.get('i318rbr23ht2tk2');
      const node2 = policy.nodeMap.get('kjsdu238dh9aeb2');
      expect(node2?.key).toBe('kjsdu238dh9aeb2');
      expect(node2?.prev?.key).toBe('i318rbr23ht2tk2');
      expect(node2?.next).toBeNull();
      expect(node1?.prev).toBeNull();
      expect(node1?.next?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed).toEqual(node2!);
      expect(policy.leastRecentlyUsed).toEqual(node1!);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
    });

    it('should not add duplicate hashes', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(1);
      expect(policy.nodeMap.has('i318rbr23ht2tk2'));

      policy.track('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(1);
    });

    it('should do nothing if the hash is already been tracked', () => {
      const setSpy = spyOn(policy.nodeMap, 'set');

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2', expect.any(Node));

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.stopTracking()', () => {
    it('should remove the hash from the state', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.nodeMap.has('kjsdu238dh9aeb2')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('8hisa6rwe2t4n');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
    });

    it('should shift other nodes if the least recently used node stops being tracked', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.nodeMap.has('i318rbr23ht2tk2')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('8hisa6rwe2t4n');
      expect(policy.leastRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
    });

    it('should shift other nodes if the most recently used node stops being tracked', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('8hisa6rwe2t4n');
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.nodeMap.has('8hisa6rwe2t4n')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
    });

    it('should do nothing if the hash is not being tracked', () => {
      const deleteSpy = spyOn(policy.nodeMap, 'delete');

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('.hit()', () => {
    it('should move the node up to most recently used node in the internal state', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('kjsdu238dh9aeb2');
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', '8hisa6rwe2t4n', 'kjsdu238dh9aeb2']);
    });

    it('should shift the least recently used node correctly', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['kjsdu238dh9aeb2', '8hisa6rwe2t4n', 'i318rbr23ht2tk2']);
    });

    it('should not shift anything if the hit hash is the most recently used hash', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('kjsdu238dh9aeb2');
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', '8hisa6rwe2t4n', 'kjsdu238dh9aeb2']);
    });
  });

  describe('.evict()', () => {
    it('should remove the least recently used hash from the state and return it', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      const hash = policy.evict();
      expect(hash).toBe('i318rbr23ht2tk2');
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.mostRecentlyUsed?.key).toBe('8hisa6rwe2t4n');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.next?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['kjsdu238dh9aeb2', '8hisa6rwe2t4n']);
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      const hash = policy.evict();
      expect(hash).toBe('i318rbr23ht2tk2');
      expect(clearTTLSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');
    });

    it('should return `null` if no hash can be evicted', () => {
      const hash = policy.evict();
      expect(hash).toBeNull();
    });
  });

  describe('.getSnapshot()', () => {
    it('should generate a snapshot of the internal state', () => {
      policy.setMockedNodes();
      expect(policy.nodeMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      const snapshot = policy.getSnapshot();
      expect(snapshot).toEqual({
        keyOrder: policy.keyOrder,
      });
    });
  });

  describe('.applySnapshot()', () => {
    it('should only set the hashes which are still valid', () => {
      const validHashes = new Set(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      const allHashes = ['i318rbr23ht2tk2', 'kjsdu238dh9aeb2', '8hisa6rwe2t4n'];

      expect(policy.nodeMap.size).toBe(0);
      policy.applySnapshot(validHashes, { keyOrder: allHashes });
      expect(policy.nodeMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.next?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
    });
  });
});
