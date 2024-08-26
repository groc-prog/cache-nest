import type { OTLPMetricExporter as OTLPMetricExporterGrpc } from '@opentelemetry/exporter-metrics-otlp-grpc';
import type { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import type { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import type { OTLPTraceExporter as OTLPTraceExporterGrpc } from '@opentelemetry/exporter-trace-otlp-grpc';
import type { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import type { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import type { CorsOptions } from 'cors';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[] | undefined
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

type NumberOrPercentage = number | `${number}%`;

/**
 * Opentelemetry exporter used by the API
 */
export enum OpenTelemetryExporter {
  CONSOLE = 'console',
  GRPC = 'grpc',
  PROTOBUFF = 'proto',
  HTTP = 'http',
}

/**
 * API configuration for server/tracing/metrics/...
 */
export interface ApiConfiguration {
  server: {
    /**
     * Port the server will be started on.
     * @default 3000
     */
    port: number;
    /**
     * Host on which the server will be started.
     * @default '0.0.0.0'
     */
    host: string;
    /**
     * Cors options.
     * @see {@link https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/cors/index.d.ts}
     */
    cors: Omit<CorsOptions, 'origin'> & { origin: Exclude<CorsOptions['origin'], (...args: any[]) => any> };
    authentication: {
      /**
       * Whether to enable authentication by checking incoming request for valid API keys.
       * @default false
       */
      enabled: boolean;
      /**
       * A list of valid API keys.
       * @default []
       */
      apiKeys: string[];
    };
  };
  drivers: {
    /**
     * Options for the memory driver.
     */
    memory: {
      /**
       * The maximum amount of memory the driver is allowed to use. Can be provided as the number of bytes or
       * a percentage value based on the total memory available.
       * @default '20%'
       */
      maxSize: NumberOrPercentage;
      recovery: {
        /**
         * Whether to enable cache persistence. Enabling this will periodically persist a snapshot of all
         * caches to the defined file. If the service stops unexpectedly, the snapshot will be applied on the
         * next startup.
         * @default false
         */
        enabled: boolean;
        /**
         * The path to the snapshot file.
         * @default '.cache-nest/memory-driver.dat'
         */
        snapshotFilePath: string;
        /**
         * The interval in seconds at which a snapshot is created.
         * @default 3600
         */
        snapshotInterval: number;
      };
    };
    fileSystem: {
      /**
       * The maximum amount of memory the driver is allowed to use. Can be provided as the number of bytes or
       * a percentage value based on the total memory available.
       * @default '20%'
       */
      maxSize: NumberOrPercentage;
      /**
       * The path to the cache directory.
       * @default '.cache-nest/file-system'
       */
      mountPath: string;
    };
  };
  tracing: {
    /**
     * Whether to enable tracing using OpenTelemetry.
     * @default false
     */
    enabled: boolean;
    /**
     * The exporter to use.
     * @default OpenTelemetryExporter.CONSOLE
     */
    exporter: OpenTelemetryExporter;
    /**
     * Additional options for the exporter.
     */
    options:
      | NonNullable<ConstructorParameters<typeof OTLPTraceExporterGrpc>[0]>
      | NonNullable<ConstructorParameters<typeof OTLPTraceExporterHttp>[0]>
      | NonNullable<ConstructorParameters<typeof OTLPTraceExporterProto>[0]>;
  };
  metrics: {
    /**
     * Whether to enable metrics using OpenTelemetry.
     * @default false
     */
    enabled: boolean;
    /**
     * The exporter to use.
     * @default OpenTelemetryExporter.CONSOLE
     */
    exporter: OpenTelemetryExporter;
    /**
     * The interval at which metrics are exported.
     * @default 10000
     */
    interval: number;
    /**
     * Additional options for the exporter.
     */
    options:
      | NonNullable<ConstructorParameters<typeof OTLPMetricExporterGrpc>[0]>
      | NonNullable<ConstructorParameters<typeof OTLPMetricExporterHttp>[0]>
      | NonNullable<ConstructorParameters<typeof OTLPMetricExporterProto>[0]>;
  };
  webUi: {
    /**
     * Whether to enable a web UI for cache visualization.
     * @default false
     */
    enabled: boolean;
  };
}
