import { merge } from 'lodash-es';

export class CacheTooBigError extends Error {
  constructor() {
    super('Cache size exceeds maximum size');
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NoCachesToEvictError extends Error {
  constructor() {
    super('No more caches to evict');
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ApiError extends Error {
  detail?: string;

  status: number;

  constructor(props?: { message?: string; detail?: string; status?: number }) {
    const mergedProps = merge(
      {},
      {
        message: 'Internal server error',
        detail: undefined,
        status: 500,
      },
      props,
    );

    super(mergedProps.detail);

    this.status = mergedProps.status;
    this.detail = mergedProps.detail;
  }
}
