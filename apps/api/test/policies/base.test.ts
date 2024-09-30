import { describe, it, expect, beforeEach, spyOn } from 'bun:test';

import { Driver, Policy, type Cache, type Identifier } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';

class TestBasePolicy extends BasePolicy {
  track(): void {}

  stopTracking(): void {}

  hit<T>(): Cache<T> {
    return null as unknown as Cache<T>;
  }

  evict(): string | null {
    return null;
  }

  get logger() {
    return this._logger;
  }

  get ttlMap() {
    return this._ttlMap;
  }

  registerMockTTL(hash: string) {
    this._ttlMap.set(
      hash,
      setTimeout(() => {}, 1000),
    );
  }
}

describe('BasePolicy', () => {
  const IDENTIFIER: Identifier = { foo: 'bar', foz: 'baz' };
  const HASH = '522179bc3c5b5988a9fc4f22bfd230205f86adaa';

  describe('constructor', () => {
    it('should set the policy and driver in the constructor', () => {
      const policy = new TestBasePolicy(Policy.LRU, Driver.MEMORY);

      expect(policy.driver).toBe(Driver.MEMORY);
      expect(policy.policy).toBe(Policy.LRU);
    });
  });

  describe('.generateHash()', () => {
    let policy: TestBasePolicy;

    beforeEach(() => {
      policy = new TestBasePolicy(Policy.LRU, Driver.MEMORY);
    });

    it('should generate a hash with a `c.` prefix from the given identifier', () => {
      const hash = policy.generateHash(IDENTIFIER);

      expect(hash).toStartWith('c.');
      expect(hash).toBe(`c.${HASH}`);
    });

    it('should generate a hash with a `i.` prefix from the given identifier', () => {
      const hash = policy.generateHash(IDENTIFIER, false);

      expect(hash).toStartWith('i.');
      expect(hash).toBe(`i.${HASH}`);
    });
  });

  describe('.generateCache()', () => {
    let policy: TestBasePolicy;

    beforeEach(() => {
      policy = new TestBasePolicy(Policy.LRU, Driver.MEMORY);
    });

    it('should generate a new cache and return it', () => {
      const cache = policy.generateCache(IDENTIFIER, {
        data: { ok: true },
        metadata: { some: 'data' },
        options: {
          invalidatedBy: ['foo', { foz: 'baz' }],
        },
      });

      expect(cache).toEqual({
        identifier: IDENTIFIER,
        hits: 0,
        ctime: expect.any(Number),
        atime: expect.any(Number),
        data: { ok: true },
        options: {
          ttl: 0,
          invalidatedBy: ['foo', { foz: 'baz' }],
        },
        metadata: { some: 'data' },
      });
    });

    it('should use defaults for properties which are not provided', () => {
      const cache = policy.generateCache(IDENTIFIER, {
        data: { ok: true },
      });

      expect(cache).toEqual({
        identifier: IDENTIFIER,
        hits: 0,
        ctime: expect.any(Number),
        atime: expect.any(Number),
        data: { ok: true },
        options: {
          ttl: 0,
          invalidatedBy: [],
        },
      });
    });

    it('should register TTL if defined', () => {
      const registerTTLSpy = spyOn(policy, 'registerTTL');
      registerTTLSpy.mockImplementation(() => {});

      policy.generateCache(IDENTIFIER, {
        data: { ok: true },
        options: {
          ttl: 1000,
        },
      });

      expect(registerTTLSpy).toHaveBeenNthCalledWith(1, `c.${HASH}`, 1000);
    });
  });

  describe('.registerTTL()', () => {
    let policy: TestBasePolicy;

    beforeEach(() => {
      policy = new TestBasePolicy(Policy.LRU, Driver.MEMORY);
    });

    it('should register a timeout with the given hash', () => {
      const setTimeoutSpy = spyOn(globalThis, 'setTimeout');

      policy.registerTTL(`c.${HASH}`, 1000);

      expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 1000);
      expect(policy.ttlMap.has(`c.${HASH}`));
    });

    it('should emit a `ttlMExpired` event and remove the hash from the ttl map', (done) => {
      policy.on('ttlExpired', (hash) => {
        expect(hash).toBe(`c.${HASH}`);
        expect(policy.ttlMap.has(`c.${HASH}`)).toBeFalse();
        done();
      });
      policy.registerTTL(`c.${HASH}`, 1);
    });
  });

  describe('.clearTTL()', () => {
    let policy: TestBasePolicy;

    beforeEach(() => {
      policy = new TestBasePolicy(Policy.LRU, Driver.MEMORY);
    });

    it('should do nothing if the hash has no TTL defined', () => {
      const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');

      policy.clearTTL('iDontExist');

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });

    it('should clear a existing TTL', () => {
      const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');

      policy.registerMockTTL(`c.${HASH}`);
      policy.clearTTL(`c.${HASH}`);

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(policy.ttlMap.has(`c.${HASH}`)).toBeFalse();
    });
  });
});
