import { describe, it, expect, beforeEach, spyOn, jest } from 'bun:test';

import { Driver } from '@cache-nest/types';

import { RRPolicy } from '@/policies/rr';

class TestRRPolicy extends RRPolicy {
  get cacheKeys() {
    return this._cacheKeys;
  }

  setMockedCacheKeys(keys: string[]) {
    keys.forEach((key) => {
      this._cacheKeys.add(key);
    });
  }
}

describe('RRPolicy', () => {
  let policy: TestRRPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new TestRRPolicy(Driver.MEMORY);
  });

  describe('ttlExpired event', () => {
    it('should delete the hash emitted with the event', () => {
      policy.setMockedCacheKeys(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      expect(policy.cacheKeys.size).toBe(2);

      policy.emit('ttlExpired', 'i318rbr23ht2tk2');
      expect(policy.cacheKeys.has('i318rbr23ht2tk2')).toBeFalse();
    });
  });

  describe('.track()', () => {
    it('should register the hash with the other cache keys', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeys.size).toBe(1);
      expect(policy.cacheKeys.has('i318rbr23ht2tk2'));

      policy.track('kjsdu238dh9aeb2');
      expect(policy.cacheKeys.size).toBe(2);
      expect(policy.cacheKeys.has('kjsdu238dh9aeb2'));
    });

    it('should not add duplicate hashes', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeys.size).toBe(1);
      expect(policy.cacheKeys.has('i318rbr23ht2tk2'));

      policy.track('i318rbr23ht2tk2');
      expect(policy.cacheKeys.size).toBe(1);
    });

    it('should do nothing if the hash is already been tracked', () => {
      const addSpy = spyOn(policy.cacheKeys, 'add');

      policy.track('i318rbr23ht2tk2');
      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');

      policy.track('i318rbr23ht2tk2');
      expect(addSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.stopTracking()', () => {
    it('should remove the hash from the other cache keys', () => {
      policy.setMockedCacheKeys(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      expect(policy.cacheKeys.size).toBe(2);

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(policy.cacheKeys.size).toBe(1);
      expect(policy.cacheKeys.has('kjsdu238dh9aeb2')).toBeFalse();
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedCacheKeys(['i318rbr23ht2tk2']);
      expect(policy.cacheKeys.size).toBe(1);

      policy.stopTracking('i318rbr23ht2tk2');
      expect(policy.cacheKeys.size).toBe(0);
      expect(clearTTLSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');
    });

    it('should do nothing if the hash is not being tracked', () => {
      const deleteSpy = spyOn(policy.cacheKeys, 'delete');

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('.hit()', () => {
    it('should be a noop', () => {
      policy.setMockedCacheKeys(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      expect(policy.cacheKeys.size).toBe(2);

      policy.hit();

      expect(policy.cacheKeys.size).toBe(2);
    });
  });

  describe('.evict()', () => {
    it('should evict a random hash', () => {
      const hashes = ['i318rbr23ht2tk2', 'kjsdu238dh9aeb2'];

      policy.setMockedCacheKeys(hashes);
      expect(policy.cacheKeys.size).toBe(2);

      const hash = policy.evict();
      expect(hash).not.toBeNull();
      expect(hashes).toContain(hash);
      expect(policy.cacheKeys.size).toBe(1);
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedCacheKeys(['i318rbr23ht2tk2']);
      expect(policy.cacheKeys.size).toBe(1);

      const hash = policy.evict();
      expect(hash).toContain('i318rbr23ht2tk2');
      expect(clearTTLSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');
    });

    it('should return `null` if no hash can be evicted', () => {
      const hash = policy.evict();
      expect(hash).toBeNull();
    });
  });

  describe('.getSnapshot()', () => {
    it('should generate a snapshot of the internal state', () => {
      policy.setMockedCacheKeys(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      expect(policy.cacheKeys.size).toBe(2);

      const snapshot = policy.getSnapshot();
      expect(snapshot).toEqual({
        cacheKeys: policy.cacheKeys,
      });
    });
  });

  describe('.applySnapshot()', () => {
    it('should only set the hashes which are still valid', () => {
      const validHashes = new Set(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      const allHashes = new Set(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2', '8hisa6rwe2t4n']);

      expect(policy.cacheKeys.size).toBe(0);
      policy.applySnapshot(validHashes, { cacheKeys: allHashes });
      expect(policy.cacheKeys.size).toBe(2);

      validHashes.forEach((hash) => {
        expect(policy.cacheKeys.has(hash)).toBeTrue();
      });
      expect(policy.cacheKeys.has('8hisa6rwe2t4n')).toBeFalse();
    });
  });
});
