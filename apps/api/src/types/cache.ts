import type { Cache } from '@cache-nest/types';

export type CreateCache<T> = Pick<Cache<T>, 'data' | 'metadata'> & Partial<Pick<Cache<T>, 'options'>>;
