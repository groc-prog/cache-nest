import { describe, it, expect, beforeEach, spyOn, jest } from 'bun:test';

import { Driver } from '@cache-nest/types';

import { LFUPolicy } from '@/policies/lfu';

class TestLFUPolicy extends LFUPolicy {
  get keyOrderMap() {
    return this._keyOrderMap;
  }

  get lowestHitCount() {
    return this._lowestHitCount;
  }

  get cacheKeyMap() {
    return this._cacheKeyMap;
  }

  setLowestHitCount(count: number) {
    this._lowestHitCount = count;
  }

  setMockedNodes() {
    this._cacheKeyMap.set('i318rbr23ht2tk2', 0);
    this._cacheKeyMap.set('kjsdu238dh9aeb2', 2);
    this._cacheKeyMap.set('8hisa6rwe2t4n', 2);

    this.keyOrderMap.set(0, ['i318rbr23ht2tk2']);
    this.keyOrderMap.set(2, ['kjsdu238dh9aeb2', '8hisa6rwe2t4n']);

    this._lowestHitCount = 0;
  }
}

describe('LFUPolicy', () => {
  let policy: TestLFUPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new TestLFUPolicy(Driver.MEMORY);
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
      expect(policy.cacheKeyMap.get('i318rbr23ht2tk2')).toBe(0);
      expect(policy.keyOrderMap.get(0)).toEqual(['i318rbr23ht2tk2']);
    });

    it('should not add duplicate hashes', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.cacheKeyMap.has('i318rbr23ht2tk2'));
      expect(policy.cacheKeyMap.get('i318rbr23ht2tk2')).toBe(0);
      expect(policy.keyOrderMap.get(0)).toEqual(['i318rbr23ht2tk2']);

      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.cacheKeyMap.get('i318rbr23ht2tk2')).toBe(0);
      expect(policy.keyOrderMap.get(0)).toEqual(['i318rbr23ht2tk2']);
    });

    it('should do nothing if the hash is already been tracked', () => {
      const setSpy = spyOn(policy.cacheKeyMap, 'set');

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2', 0);

      policy.track('i318rbr23ht2tk2');
      expect(setSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.stopTracking()', () => {
    it('should remove the hash from the state', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(clearTTLSpy).toHaveBeenCalledWith('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrderMap.size).toBe(2);
      expect(policy.cacheKeyMap.has('kjsdu238dh9aeb2')).toBeFalse();
      expect(policy.keyOrderMap.get(2)).not.toContain('kjsdu238dh9aeb2');
    });

    it('should remove the key from the key order map if no more hashes share the hit count', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.cacheKeyMap.set('kjsdu238dh9aeb2', 0);
      policy.cacheKeyMap.set('i318rbr23ht2tk2', 1);
      policy.keyOrderMap.set(0, ['kjsdu238dh9aeb2']);
      policy.keyOrderMap.set(1, ['i318rbr23ht2tk2']);
      policy.setLowestHitCount(1);

      policy.stopTracking('i318rbr23ht2tk2');
      expect(clearTTLSpy).toHaveBeenCalledWith('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.cacheKeyMap.has('i318rbr23ht2tk2')).toBeFalse();
      expect(policy.keyOrderMap.size).toBe(1);
      expect(policy.keyOrderMap.has(1)).toBeFalse();
      expect(policy.lowestHitCount).toBe(0);
    });

    it('should do nothing if the hash is not being tracked', () => {
      const deleteSpy = spyOn(policy.cacheKeyMap, 'delete');

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('.hit()', () => {
    it('should update the highest hit count, key order and hash map', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);

      policy.hit('kjsdu238dh9aeb2');
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(3);
      expect(policy.keyOrderMap.has(3)).toBeTrue();
      expect(policy.keyOrderMap.get(3)).toEqual(['kjsdu238dh9aeb2']);
      expect(policy.lowestHitCount).toBe(3);
    });

    it('should do nothing if the hash is not being tracked in the hash map', () => {
      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);

      const setCacheKeyMapSpy = spyOn(policy.cacheKeyMap, 'set');

      policy.hit('otherhash');
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);
      expect(setCacheKeyMapSpy).not.toHaveBeenCalled();
    });

    it('should do nothing if the hash is not being tracked in the key order map', () => {
      policy.setMockedNodes();
      policy.cacheKeyMap.set('otherhash', 0);
      expect(policy.cacheKeyMap.size).toBe(4);
      expect(policy.keyOrderMap.size).toBe(2);

      const setCacheKeyMapSpy = spyOn(policy.cacheKeyMap, 'set');

      policy.hit('otherhash');
      expect(policy.cacheKeyMap.size).toBe(4);
      expect(policy.keyOrderMap.size).toBe(2);
      expect(setCacheKeyMapSpy).not.toHaveBeenCalled();
    });
  });

  describe('.evict()', () => {
    it('should remove the hash with the least hits', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);

      const hash = policy.evict();
      expect(clearTTLSpy).toHaveBeenCalledWith('i318rbr23ht2tk2');
      expect(hash).toBe('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrderMap.size).toBe(1);
      expect(policy.lowestHitCount).toBe(2);
    });

    it('should update the lowest hit count correctly', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedNodes();
      expect(policy.cacheKeyMap.size).toBe(3);
      expect(policy.keyOrderMap.size).toBe(2);

      let hash = policy.evict();
      expect(hash).toBe('i318rbr23ht2tk2');
      expect(clearTTLSpy).toHaveBeenCalledWith('i318rbr23ht2tk2');
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrderMap.size).toBe(1);
      expect(policy.lowestHitCount).toBe(2);

      hash = policy.evict();
      expect(hash).toBe('8hisa6rwe2t4n');
      expect(policy.cacheKeyMap.size).toBe(1);
      expect(policy.keyOrderMap.size).toBe(1);
      expect(policy.lowestHitCount).toBe(2);
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
      expect(policy.keyOrderMap).toHaveLength(2);

      const snapshot = policy.getSnapshot();
      expect(snapshot).toEqual({
        keyOrderMap: policy.keyOrderMap,
      });
    });
  });

  describe('.applySnapshot()', () => {
    it('should only set the hashes which are still valid', () => {
      const validHashes = new Set(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      const keyOrderMap = new Map();
      keyOrderMap.set(0, ['i318rbr23ht2tk2']);
      keyOrderMap.set(2, ['kjsdu238dh9aeb2', '8hisa6rwe2t4n']);

      expect(policy.cacheKeyMap.size).toBe(0);
      policy.applySnapshot(validHashes, { keyOrderMap });
      expect(policy.cacheKeyMap.size).toBe(2);
      expect(policy.keyOrderMap).toHaveLength(2);
      expect(policy.lowestHitCount).toBe(0);
      expect(policy.cacheKeyMap.get('i318rbr23ht2tk2')).toBe(0);
      expect(policy.cacheKeyMap.get('kjsdu238dh9aeb2')).toBe(2);
      expect(policy.keyOrderMap.get(0)).toEqual(['i318rbr23ht2tk2']);
      expect(policy.keyOrderMap.get(2)).toEqual(['kjsdu238dh9aeb2']);
    });
  });
});
