import { t } from 'elysia';

import type { ElysiaApp } from '@/index';
import { OpenTelemetryExporter } from '@/types/configuration';

const router = (app: ElysiaApp) =>
  app.group('/server', (group) =>
    group.get(
      '/configuration',
      ({ configuration }) => ({
        ...configuration,
        server: {
          ...configuration.server,
          authentication: {
            enabled: configuration.server.authentication.enabled,
          },
          cors: {
            origin: configuration.server.cors.origin as boolean | string | (boolean | string)[],
          },
        },
      }),
      {
        detail: {
          tags: ['Server'],
          summary: 'Get currently used API configuration',
          description: `Returns the used API configuration. If the configuration has authentication enabled,
            defined API keys will be omitted from the response.
          `,
        },
        response: t.Object({
          server: t.Object({
            port: t.Number({ default: 3000, description: 'Port the server is running on.' }),
            host: t.String({ default: '0.0.0.0', description: 'Host the server is running on.' }),
            cors: t.Object({
              origin: t.Union([t.Boolean(), t.String(), t.Array(t.Union([t.Boolean(), t.String()]))], {
                default: '*',
                description: 'Allowed CORS origins.',
              }),
            }),
            authentication: t.Object({
              enabled: t.Boolean({
                default: false,
                description: 'Whether authentication using API keys is enabled.',
              }),
            }),
            enableSwagger: t.Boolean({
              default: false,
              description: 'Whether Swagger documentation is exposed on `/swagger` endpoint.',
            }),
          }),
          drivers: t.Object({
            memory: t.Object({
              maxSize: t.Union([t.String(), t.Number()], {
                default: '20%',
                description: 'Maximum amount of memory the driver is allowed to use.',
              }),
              recovery: t.Object({
                enabled: t.Boolean({
                  default: false,
                  description: 'Whether cache is periodically persisted to snapshot file.',
                }),
                snapshotFilePath: t.String({
                  default: '.cache-nest/memory-driver.dat',
                  description: 'Path to snapshot file.',
                }),
                snapshotInterval: t.Number({
                  default: 3600,
                  minimum: 1,
                  description: 'Interval in seconds at which a snapshots are created.',
                }),
              }),
            }),
            fileSystem: t.Object({
              maxSize: t.Union([t.String(), t.Number()], {
                default: '20%',
                description: 'Maximum amount of disk space the driver is allowed to use.',
              }),
              mountPath: t.String({
                default: '.cache-nest/file-system',
                description: 'Path to the cache directory.',
              }),
            }),
          }),
          tracing: t.Object({
            enabled: t.Boolean({ default: false, description: 'Whether tracing using OpenTelemetry is enabled.' }),
            exporter: t.Enum(OpenTelemetryExporter, {
              default: OpenTelemetryExporter.CONSOLE,
              description: 'Exporter used for traces.',
            }),
            url: t.Optional(
              t.String({
                description: 'The URL the traces are exported to. Default value depends on the used exporter.',
              }),
            ),
          }),
          metrics: t.Object({
            enabled: t.Boolean({ default: false, description: 'Whether metrics using OpenTelemetry is enabled.' }),
            exporter: t.Enum(OpenTelemetryExporter, {
              default: OpenTelemetryExporter.CONSOLE,
              description: 'Exporter used for metrics.',
            }),
            interval: t.Number({
              default: 10000,
              minimum: 1,
              description: 'Interval at which metrics are exported.',
            }),
            url: t.Optional(
              t.String({
                description: 'The URL the metrics are exported to. Default value depends on the used exporter.',
              }),
            ),
          }),
          webUi: t.Object({
            enabled: t.Boolean({
              default: false,
              description: 'Whether the web UI for cache visualization is enabled.',
            }),
          }),
        }),
      },
    ),
  );

export default router;
