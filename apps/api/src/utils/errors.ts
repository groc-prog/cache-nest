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
