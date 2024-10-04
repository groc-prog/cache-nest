import { Driver, Policy } from '@cache-nest/types';

import { BasePolicy } from '@/policies/base';
import { tracer } from '@/utils/opentelemetry';

interface FIFOSnapshot {
  queue: string[];
}

export class FIFOPolicy extends BasePolicy {
  protected _queue: string[] = [];

  protected _hashes: Set<string> = new Set<string>();

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
        if (this._hashes.has(hash)) {
          this._logger.warn(`Hash ${hash} is already being tracked`);
          span.end();
          return;
        }

        this._logger.verbose(`Tracking new hash ${hash}`);
        this._queue.push(hash);
        this._hashes.add(hash);
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
        const index = this._queue.findIndex((key) => key === hash);
        if (!this._hashes.has(hash) || index === -1) {
          this._logger.warn(`Hash ${hash} is not being tracked, can not stop tracking`);
          span.end();
          return;
        }

        this._logger.verbose(`Stop tracking hash ${hash}`);
        this._queue.splice(index, 1);
        this._hashes.delete(hash);
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
        const hash = this._queue.shift();

        if (hash) {
          this._hashes.delete(hash);
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
        const snapshot: FIFOSnapshot = {
          queue: this._queue,
        };

        span.end();
        return snapshot;
      },
    );
  }

  applySnapshot(hashes: Set<string>, { queue }: FIFOSnapshot): void {
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
        for (const hash of queue) {
          if (!hashes.has(hash)) continue;

          this._queue.push(hash);
          this._hashes.add(hash);
        }

        span.end();
      },
    );
  }
}
