import type { Cache, DeepPartial } from '@cache-nest/types';

export type CreateCache<T> = Pick<Cache<T>, 'data' | 'metadata'> & DeepPartial<Pick<Cache<T>, 'options'>>;
