import { Policy } from './cache.js';

/**
 * Response interface for a drivers resource usage.
 */
export type DriverResourceUsage = {
  -readonly [K in keyof typeof Policy as Lowercase<K>]: {
    cacheCount: number;
    relativeSize: number;
    size: number;
  };
} & {
  total: number;
};
