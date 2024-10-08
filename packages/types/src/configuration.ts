import type { cors } from '@elysiajs/cors';

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
 * API configuration for server/tracing/metrics/etc before parsing.
 */
export interface UnparsedApiConfiguration {
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
     * Whether to expose Swagger documentation on `/swagger`.
     * @default false
     */
    enableSwagger: boolean;
    /**
     * Cors options.
     * @see {@link https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/cors/index.d.ts|Cors on Github}
     */
    cors: {
      /**
       * Allowed CORS origins.
       * @default '*'
       */
      origin: NonNullable<Parameters<typeof cors>[0]>['origin'];
    };
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
      /**
       * Whether to evict caches from other policies if a new cache is too big for storage even after all existing
       * caches from the current policy have been evicted.
       * @default false
       */
      evictFromOthers: boolean;
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
       * The maximum amount of disk space the driver is allowed to use. Can be provided as the number of bytes or
       * a percentage value based on the total disk space available.
       * @default '20%'
       */
      maxSize: NumberOrPercentage;
      /**
       * The path to the cache directory.
       * @default '.cache-nest/file-system'
       */
      mountPath: string;
      /**
       * Whether to evict caches from other policies if a new cache is too big for storage even after all existing
       * caches from the current policy have been evicted.
       * @default false
       */
      evictFromOthers: boolean;
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
         * @default '.cache-nest/file-system-driver.dat'
         */
        snapshotFilePath: string;
        /**
         * The interval in seconds at which a snapshot is created.
         * @default 3600
         */
        snapshotInterval: number;
      };
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
     * The URL the traces are exported to.
     */
    url?: string;
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
     * The URL the traces are exported to.
     */
    url?: string;
  };
  webUi: {
    /**
     * Whether to enable a web UI for cache visualization.
     * @default false
     */
    enabled: boolean;
  };
}

export interface ApiConfiguration extends UnparsedApiConfiguration {
  drivers: {
    memory: {
      maxSize: number;
    } & UnparsedApiConfiguration['drivers']['memory'];
    fileSystem: {
      maxSize: number;
    } & UnparsedApiConfiguration['drivers']['fileSystem'];
  };
}
