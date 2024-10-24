import { sample } from 'lodash-es';

import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies';
import { tracer } from '@/setup/opentelemetry';

interface RRSnapshot {
  cacheKeys: Set<string>;
}

export class RRPolicy extends BasePolicy {
  protected _cacheKeys: Set<string> = new Set<string>();

  constructor(driver: Driver) {
    super(Policy.RR, driver);

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
        if (this._cacheKeys.has(hash)) {
          this._logger.warn(`Hash ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new hash ${hash}`);
        this._cacheKeys.add(hash);
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
        if (!this._cacheKeys.has(hash)) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

        this._logger.verbose(`Stop tracking hash ${hash}`);
        this._cacheKeys.delete(hash);
        this.clearTTL(hash);
        span.end();
      },
    );
  }

  hit(): void {}

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
        const hash = sample([...this._cacheKeys]);
        if (hash) {
          this._cacheKeys.delete(hash);
          this.clearTTL(hash);
        }

        span.end();
        return hash || null;
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
        const snapshot: RRSnapshot = {
          cacheKeys: this._cacheKeys,
        };

        span.end();
        return snapshot;
      },
    );
  }

  applySnapshot(hashes: Set<string>, { cacheKeys }: RRSnapshot): void {
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
        for (const key of cacheKeys.keys()) {
          if (hashes.has(key)) this._cacheKeys.add(key);
        }

        span.end();
      },
    );
  }
}
