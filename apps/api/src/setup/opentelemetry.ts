import { trace, metrics, ValueType } from '@opentelemetry/api';
import { OTLPMetricExporter as OTLPMetricExporterGrpc } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import { FsInstrumentation } from '@opentelemetry/instrumentation-fs';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_NAME,
  SEMRESATTRS_PROCESS_PID,
} from '@opentelemetry/semantic-conventions';
import { env } from 'bun';
import os from 'os';

import { OpenTelemetryExporter } from '@cache-nest/types';

import { getApiConfiguration } from '@/setup/configuration';

const SERVICE_NAME = 'cache-nest';

let traceExporter: OTLPTraceExporterGrpc | OTLPTraceExporterHttp | OTLPTraceExporterProto | ConsoleSpanExporter;
let metricsExporter: OTLPMetricExporterGrpc | OTLPMetricExporterHttp | OTLPMetricExporterProto | ConsoleMetricExporter;

const apiConfiguration = await getApiConfiguration();

switch (apiConfiguration.tracing.exporter) {
  case OpenTelemetryExporter.HTTP:
    traceExporter = new OTLPTraceExporterHttp({
      url: apiConfiguration.tracing.url,
    });
    break;
  case OpenTelemetryExporter.PROTOBUFF:
    traceExporter = new OTLPTraceExporterProto({
      url: apiConfiguration.tracing.url,
    });
    break;
  case OpenTelemetryExporter.GRPC:
    traceExporter = new OTLPTraceExporterGrpc({
      url: apiConfiguration.tracing.url,
    });
    break;
  default:
    traceExporter = new ConsoleSpanExporter();
    break;
}

switch (apiConfiguration.metrics.exporter) {
  case OpenTelemetryExporter.HTTP:
    metricsExporter = new OTLPMetricExporterHttp({
      url: apiConfiguration.metrics.url,
    });
    break;
  case OpenTelemetryExporter.PROTOBUFF:
    metricsExporter = new OTLPMetricExporterProto({
      url: apiConfiguration.metrics.url,
    });
    break;
  case OpenTelemetryExporter.GRPC:
    metricsExporter = new OTLPMetricExporterGrpc({
      url: apiConfiguration.metrics.url,
    });
    break;
  default:
    metricsExporter = new ConsoleMetricExporter();
    break;
}

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: env.VERSION,
    [SEMRESATTRS_HOST_NAME]: os.hostname(),
    [SEMRESATTRS_PROCESS_PID]: process.pid,
  }),
  traceExporter: apiConfiguration.tracing.enabled ? traceExporter : undefined,
  spanProcessors: apiConfiguration.tracing.enabled ? [new BatchSpanProcessor(traceExporter)] : undefined,
  metricReader: apiConfiguration.metrics.enabled
    ? new PeriodicExportingMetricReader({
        exporter: metricsExporter,
        exportIntervalMillis: apiConfiguration.metrics.interval,
      })
    : undefined,
  instrumentations: [new HttpInstrumentation(), new FsInstrumentation()],
});

sdk.start();

export const tracer = trace.getTracer(SERVICE_NAME, env.VERSION);
const meter = metrics.getMeter(SERVICE_NAME, env.VERSION);

export const createdCachesCounter = meter.createCounter('caches_created_total', {
  description: 'Number of created caches',
  valueType: ValueType.INT,
});
export const deletedCachesCounter = meter.createCounter('caches_deleted_total', {
  description: 'Number of deleted caches',
  valueType: ValueType.INT,
});
export const cacheLookupsCounter = meter.createCounter('cache_lookups_total', {
  description: 'Number of cache lookups',
  valueType: ValueType.INT,
});
export const cacheHitsCounter = meter.createCounter('cache_hits_total', {
  description: 'Number of cache hits',
  valueType: ValueType.INT,
});
export const cacheMissesCounter = meter.createCounter('cache_misses_total', {
  description: 'Number of cache misses',
  valueType: ValueType.INT,
});
export const totalEvictionsCounter = meter.createCounter('cache_evictions_total', {
  description: 'Number of cache evictions',
  valueType: ValueType.INT,
});
export const ttlEvictionsCounter = meter.createCounter('cache_evictions_ttl_total', {
  description: 'Number of cache evictions due to TTL',
  valueType: ValueType.INT,
});
export const invalidationEvictionsCounter = meter.createCounter('cache_evictions_invalidation_total', {
  description: 'Number of cache evictions due to manual invalidation',
  valueType: ValueType.INT,
});
export const sizeLimitEvictionsCounter = meter.createCounter('cache_evictions_size_limit_total', {
  description: 'Number of cache evictions due to a size limit',
  valueType: ValueType.INT,
});
