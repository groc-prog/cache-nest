import { describe, it, expect, beforeEach, spyOn, jest } from 'bun:test';

import { Driver } from '@cache-nest/types';

import { MRUNode, MRUPolicy } from '@/policies/mru';

class TestMRUPolicy extends MRUPolicy {
  get keyOrder() {
    return this._keyOrder;
  }

  get mostRecentlyUsed() {
    return this._mostRecentlyUsed;
  }

  get leastRecentlyUsed() {
    return this._leastRecentlyUsed;
  }

  get cacheKeyMap() {
    return this._cacheKeyMap;
  }

  setMockedKeyOrder(order: string[]) {
    this._keyOrder = order;
  }

  setMockedCacheKeyMap(map: Record<string, MRUNode>) {
    Object.keys(map).forEach((hash) => {
      this._cacheKeyMap.set(hash, map[hash] as MRUNode);
    });
  }

  setMockedMostRecentlyUsedNode(node: MRUNode) {
    this._mostRecentlyUsed = node;
  }

  setMockedLeastRecentlyUsedNode(node: MRUNode) {
    this._leastRecentlyUsed = node;
  }

  setMockedNodes() {
    const node1 = new MRUNode('i318rbr23ht2tk2');
    const node2 = new MRUNode('kjsdu238dh9aeb2');
    const node3 = new MRUNode('8hisa6rwe2t4n');

    node1.next = node2;
    node2.prev = node1;
    node2.next = node3;
    node3.prev = node2;

    this.setMockedLeastRecentlyUsedNode(node1);
    this.setMockedMostRecentlyUsedNode(node3);
    this.setMockedCacheKeyMap({
      i318rbr23ht2tk2: node1,
      kjsdu238dh9aeb2: node2,
      '8hisa6rwe2t4n': node3,
    });
    this.setMockedKeyOrder(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2', '8hisa6rwe2t4n']);
  }
}

describe('MRUPolicy', () => {
  let policy: TestMRUPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new TestMRUPolicy(Driver.MEMORY);
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
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.cacheKeyMap.has('i318rbr23ht2tk2'));

      let node1 = policy.cacheKeyMap.get('i318rbr23ht2tk2');
      expect(node1?.key).toBe('i318rbr23ht2tk2');
      expect(node1?.prev).toBeNull();
      expect(node1?.next).toBeNull();
      expect(policy.mostRecentlyUsed).toEqual(node1!);
      expect(policy.leastRecentlyUsed).toEqual(node1!);
      expect(policy.keyOrder).toHaveLength(1);
      expect(policy.keyOrder).toContain('i318rbr23ht2tk2');

      policy.track('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.cacheKeyMap.has('kjsdu238dh9aeb2'));

      node1 = policy.cacheKeyMap.get('i318rbr23ht2tk2');
      const node2 = policy.cacheKeyMap.get('kjsdu238dh9aeb2');
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
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.cacheKeyMap.has('i318rbr23ht2tk2'));

      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(1);
    });

    it('should do nothing if the hash is already been tracked', () => {
      const setSpy = spyOn(policy.cacheKeyMap, 'set');

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2', expect.any(MRUNode));

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.stopTracking()', () => {
    it('should remove the hash from the state', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.cacheKeyMap.has('kjsdu238dh9aeb2')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('8hisa6rwe2t4n');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
    });

    it('should shift other nodes if the least recently used node stops being tracked', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.cacheKeyMap.has('i318rbr23ht2tk2')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('8hisa6rwe2t4n');
      expect(policy.leastRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
    });

    it('should shift other nodes if the most recently used node stops being tracked', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.stopTracking('8hisa6rwe2t4n');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.cacheKeyMap.has('8hisa6rwe2t4n')).toBeFalse();
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
    });

    it('should do nothing if the hash is not being tracked', () => {
      const deleteSpy = spyOn(policy.cacheKeyMap, 'delete');

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('.hit()', () => {
    it('should move the node up to most recently used node in the internal state', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', '8hisa6rwe2t4n', 'kjsdu238dh9aeb2']);
    });

    it('should shift the least recently used node correctly', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['kjsdu238dh9aeb2', '8hisa6rwe2t4n', 'i318rbr23ht2tk2']);
    });

    it('should not shift anything if the hit hash is the most recently used hash', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      policy.hit('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('8hisa6rwe2t4n');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', '8hisa6rwe2t4n', 'kjsdu238dh9aeb2']);
    });
  });

  describe('.evict()', () => {
    it('should remove the most recently used hash from the state and return it', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      const hash = policy.evict();
      expect(hash).toBe('8hisa6rwe2t4n');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.next?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrder).toHaveLength(3);

      const hash = policy.evict();
      expect(hash).toBe('8hisa6rwe2t4n');
      expect(clearTTLSpy).toHaveBeenNthCalledWith(1, '8hisa6rwe2t4n');
    });

    it('should return `null` if no hash can be evicted', () => {
      const hash = policy.evict();
      expect(hash).toBeNull();
    });
  });

  describe('.getSnapshot()', () => {
    it('should generate a snapshot of the internal state', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
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

      expect(policy.cacheKeyMap.size).toBe(0);
      policy.applySnapshot(validHashes, { keyOrder: allHashes });
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrder).toHaveLength(2);
      expect(policy.mostRecentlyUsed?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.mostRecentlyUsed?.prev?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.key).toBe('i318rbr23ht2tk2');
      expect(policy.leastRecentlyUsed?.next?.key).toBe('kjsdu238dh9aeb2');
      expect(policy.keyOrder).toEqual(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
    });
  });
});
