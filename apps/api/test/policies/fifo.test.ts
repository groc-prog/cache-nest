import { describe, it, expect, beforeEach, spyOn, jest } from 'bun:test';

import { Driver } from '@cache-nest/types';

import { FIFOPolicy } from '@/policies/fifo';

class TestFIFOPolicy extends FIFOPolicy {
  get queue() {
    return this._queue;
  }

  get hashes() {
    return this._hashes;
  }

  setMockedQueue() {
    this._queue.push('i318rbr23ht2tk2');
    this._queue.push('kjsdu238dh9aeb2');
    this._queue.push('8hisa6rwe2t4n');

    this._hashes.add('i318rbr23ht2tk2');
    this._hashes.add('kjsdu238dh9aeb2');
    this._hashes.add('8hisa6rwe2t4n');
  }
}

describe('FIFOPolicy', () => {
  let policy: TestFIFOPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new TestFIFOPolicy(Driver.MEMORY);
  });

  describe('ttlExpired event', () => {
    it('should delete the hash emitted with the event', () => {
      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

      policy.emit('ttlExpired', 'i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(2);
      expect(policy.queue).not.toContain('i318rbr23ht2tk2');
      expect(policy.hashes.size).toBe(2);
      expect(policy.hashes.has('i318rbr23ht2tk2')).toBeFalse();
    });
  });

  describe('.track()', () => {
    it('should register the hash with the other cache keys', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(1);
      expect(policy.queue).toContain('i318rbr23ht2tk2');
      expect(policy.hashes.size).toBe(1);
      expect(policy.hashes.has('i318rbr23ht2tk2')).toBeTrue();

      policy.track('kjsdu238dh9aeb2');
      expect(policy.queue).toHaveLength(2);
      expect(policy.queue).toContain('kjsdu238dh9aeb2');
      expect(policy.hashes.size).toBe(2);
      expect(policy.hashes.has('kjsdu238dh9aeb2')).toBeTrue();
    });

    it('should not add duplicate hashes', () => {
      policy.track('i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(1);
      expect(policy.queue).toContain('i318rbr23ht2tk2');
      expect(policy.hashes.size).toBe(1);
      expect(policy.hashes.has('i318rbr23ht2tk2')).toBeTrue();

      policy.track('i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(1);
      expect(policy.hashes.size).toBe(1);
    });

    it('should do nothing if the hash is already been tracked', () => {
      const pushSpy = spyOn(policy.queue, 'push');

      policy.track('i318rbr23ht2tk2');
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');

      policy.track('i318rbr23ht2tk2');
      expect(pushSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('.stopTracking()', () => {
    it('should remove the hash from the other cache keys', () => {
      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(policy.queue).toHaveLength(2);
      expect(policy.hashes.size).toBe(2);
      expect(policy.queue).not.toContain('kjsdu238dh9aeb2');
      expect(policy.hashes.has('kjsdu238dh9aeb2')).toBeFalse();
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

      policy.stopTracking('i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(2);
      expect(policy.hashes.size).toBe(2);
      expect(clearTTLSpy).toHaveBeenNthCalledWith(1, 'i318rbr23ht2tk2');
    });

    it('should do nothing if the hash is not being tracked', () => {
      const deleteSpy = spyOn(policy.queue, 'shift');

      policy.stopTracking('kjsdu238dh9aeb2');
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('.evict()', () => {
    it('should evict the hash which has been added to the queue first', () => {
      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

      const hash = policy.evict();
      expect(hash).not.toBeNull();
      expect(hash).toContain('i318rbr23ht2tk2');
      expect(policy.queue).toHaveLength(2);
      expect(policy.queue).not.toContain('i318rbr23ht2tk2');
      expect(policy.hashes.size).toBe(2);
      expect(policy.hashes.has('i318rbr23ht2tk2')).toBeFalse();
    });

    it('should clear any TTL timers defined for the hash', () => {
      const clearTTLSpy = spyOn(policy, 'clearTTL');

      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

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
      policy.setMockedQueue();
      expect(policy.queue).toHaveLength(3);
      expect(policy.hashes.size).toBe(3);

      const snapshot = policy.getSnapshot();
      expect(snapshot).toEqual({
        queue: policy.queue,
      });
    });
  });

  describe('.applySnapshot()', () => {
    it('should only set the hashes which are still valid', () => {
      const validHashes = new Set(['i318rbr23ht2tk2', 'kjsdu238dh9aeb2']);
      const allHashes = ['i318rbr23ht2tk2', 'kjsdu238dh9aeb2', '8hisa6rwe2t4n'];

      expect(policy.queue).toHaveLength(0);
      policy.applySnapshot(validHashes, { queue: allHashes });
      expect(policy.queue).toHaveLength(2);
      expect(policy.hashes.size).toBe(2);

      validHashes.forEach((hash) => {
        expect(policy.queue).toContain(hash);
        expect(policy.hashes.has(hash)).toBeTrue();
      });
      expect(policy.queue).not.toContain('8hisa6rwe2t4n');
      expect(policy.hashes.has('8hisa6rwe2t4n')).toBeFalse();
    });
  });
});
