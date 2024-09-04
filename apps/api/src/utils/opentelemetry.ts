import { trace, metrics, ValueType } from '@opentelemetry/api';

const meter = metrics.getMeter('cache-nest');
export const tracer = trace.getTracer('cache-nest');

export const createdCachesCounter = meter.createCounter('cache.created', {
  description: 'Number of created caches',
  valueType: ValueType.INT,
});
export const cacheLookupsCounter = meter.createCounter('cache.lookups', {
  description: 'Number of cache lookups',
  valueType: ValueType.INT,
});
export const cacheHitsCounter = meter.createCounter('cache.hits', {
  description: 'Number of cache hits',
  valueType: ValueType.INT,
});
export const cacheMissesCounter = meter.createCounter('cache.misses', {
  description: 'Number of cache misses',
  valueType: ValueType.INT,
});
export const totalEvictionsCounter = meter.createCounter('cache.evictions.total', {
  description: 'Number of cache evictions',
  valueType: ValueType.INT,
});
export const ttlEvictionsCounter = meter.createCounter('cache.evictions.ttl', {
  description: 'Number of cache evictions due to TTL',
  valueType: ValueType.INT,
});
export const invalidationEvictionsCounter = meter.createCounter('cache.evictions.invalidation', {
  description: 'Number of cache evictions due to manual invalidation',
  valueType: ValueType.INT,
});
export const sizeLimitEvictionsCounter = meter.createCounter('cache.evictions.sizeLimit', {
  description: 'Number of cache evictions due to a size limit',
  valueType: ValueType.INT,
});
