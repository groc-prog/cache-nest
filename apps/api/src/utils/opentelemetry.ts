import { trace, metrics, ValueType } from '@opentelemetry/api';

const meter = metrics.getMeter('cache-nest');
export const tracer = trace.getTracer('cache-nest');

export const createdCachesCounter = meter.createCounter('cache_nest_caches_created_total', {
  description: 'Number of created caches',
  valueType: ValueType.INT,
});
export const deletedCachesCounter = meter.createCounter('cache_nest_caches_deleted_total', {
  description: 'Number of deleted caches',
  valueType: ValueType.INT,
});
export const cacheLookupsCounter = meter.createCounter('cache_nest_cache_lookups_total', {
  description: 'Number of cache lookups',
  valueType: ValueType.INT,
});
export const cacheHitsCounter = meter.createCounter('cache_nest_cache_hits_total', {
  description: 'Number of cache hits',
  valueType: ValueType.INT,
});
export const cacheMissesCounter = meter.createCounter('cache_nest_cache_misses_total', {
  description: 'Number of cache misses',
  valueType: ValueType.INT,
});
export const totalEvictionsCounter = meter.createCounter('cache_nest_cache_evictions_total', {
  description: 'Number of cache evictions',
  valueType: ValueType.INT,
});
export const ttlEvictionsCounter = meter.createCounter('cache_nest_cache_evictions_ttl_total', {
  description: 'Number of cache evictions due to TTL',
  valueType: ValueType.INT,
});
export const invalidationEvictionsCounter = meter.createCounter('cache_nest_cache_evictions_invalidation_total', {
  description: 'Number of cache evictions due to manual invalidation',
  valueType: ValueType.INT,
});
export const sizeLimitEvictionsCounter = meter.createCounter('cache_nest_cache_evictions_size_limit_total', {
  description: 'Number of cache evictions due to a size limit',
  valueType: ValueType.INT,
});
