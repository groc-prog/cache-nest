import { OTLPMetricExporter as OTLPMetricExporterGrpc } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import { FsInstrumentation } from '@opentelemetry/instrumentation-fs';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, AlwaysOnSampler, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_HOST_NAME } from '@opentelemetry/semantic-conventions';
import { env } from 'bun';
import fse from 'fs-extra';
import jsYaml from 'js-yaml';
import { isNumber, merge } from 'lodash-es';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import { type ApiConfiguration, type DeepReadonly, OpenTelemetryExporter } from '@cache-nest/types';

import logger from '@/utils/logger';

const API_CONFIG_FILENAME: Readonly<string> = 'cache-nest-config';
const API_CONFIG_FILEPATH: Readonly<string> = env.NODE_ENV !== 'production' ? '.' : '/etc';
export const API_SERVICE_NAME: Readonly<string> = 'cache-nest';
export const API_CONFIG_DEFAULTS: DeepReadonly<ApiConfiguration> = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    enableSwagger: false,
    cors: {
      origin: '*',
    },
    authentication: {
      enabled: false,
      apiKeys: [],
    },
  },
  drivers: {
    memory: {
      maxSize: '20%',
      evictFromOthers: false,
      recovery: {
        enabled: false,
        snapshotFilePath: '.cache-nest/memory-driver.dat',
        snapshotInterval: 3600,
      },
    },
    fileSystem: {
      maxSize: '20%',
      mountPath: '.cache-nest/file-system',
      evictFromOthers: false,
      recovery: {
        enabled: false,
        snapshotFilePath: '.cache-nest/file-system-driver.dat',
        snapshotInterval: 3600,
      },
    },
  },
  tracing: {
    enabled: false,
    exporter: OpenTelemetryExporter.CONSOLE,
  },
  metrics: {
    enabled: false,
    exporter: OpenTelemetryExporter.CONSOLE,
    interval: 10000,
  },
  webUi: {
    enabled: false,
  },
};

const NumberOrPercentageValidator = z.union([z.string(), z.number()]).superRefine((value, ctx) => {
  if (isNumber(value)) {
    if (value <= 0)
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: 'number',
        inclusive: true,
        message: 'maxSize must be greater than 0',
      });
    if (value >= os.totalmem())
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: os.totalmem(),
        type: 'number',
        inclusive: true,
        message: 'maxSize must be less than the total memory/storage',
      });
  } else {
    const percentage = parseInt(value.replace('%', ''));
    if (isNaN(percentage))
      return ctx.addIssue({
        code: z.ZodIssueCode.invalid_type,
        expected: 'number',
        received: 'string',
        message: 'maxSize must be a number or a percentage string',
      });

    if (percentage <= 0)
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: 'number',
        inclusive: true,
        message: 'maxSize must be greater than 0%',
      });

    if (percentage >= 100)
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: 100,
        type: 'number',
        inclusive: true,
        message: 'maxSize must be less than 100%',
      });
  }
});

const ApiConfigurationValidator = z.object({
  server: z.object({
    port: z.number(),
    host: z.string(),
    enableSwagger: z.boolean(),
    cors: z.object({
      origin: z.union([z.boolean(), z.string(), z.array(z.boolean()), z.array(z.string())]),
    }),
    authentication: z.object({
      enabled: z.boolean(),
      apiKeys: z.array(z.string()),
    }),
  }),
  drivers: z.object({
    memory: z.object({
      maxSize: NumberOrPercentageValidator,
      evictFromOthers: z.boolean(),
      recovery: z.object({
        enabled: z.boolean(),
        snapshotFilePath: z.string().refine((filePath) => filePath.endsWith('.dat'), 'File must be a .dat file'),
        snapshotInterval: z.number().positive(),
      }),
    }),
    fileSystem: z.object({
      maxSize: NumberOrPercentageValidator,
      mountPath: z.string(),
      evictFromOthers: z.boolean(),
      recovery: z.object({
        enabled: z.boolean(),
        snapshotFilePath: z.string().refine((filePath) => filePath.endsWith('.dat'), 'File must be a .dat file'),
        snapshotInterval: z.number().positive(),
      }),
    }),
  }),
  tracing: z.object({
    enabled: z.boolean(),
    exporter: z.nativeEnum(OpenTelemetryExporter),
    url: z.string().optional(),
  }),
  metrics: z.object({
    enabled: z.boolean(),
    exporter: z.nativeEnum(OpenTelemetryExporter),
    interval: z.number().positive(),
    url: z.string().optional(),
  }),
  webUi: z.object({
    enabled: z.boolean(),
  }),
});

/**
 * Starts the NodeJS Opentelemetry SDK with the defined configuration.
 * @async
 */
async function startSDK(
  tracingConfig: ApiConfiguration['tracing'],
  metricsConfig: ApiConfiguration['metrics'],
): Promise<void> {
  if (!tracingConfig.enabled && !metricsConfig.enabled) {
    logger.debug('Tracing and metrics disabled, skipping OpenTelemetry initialization');
    return;
  }

  logger.info('Setting up OpenTelemetry SKD');
  let traceExporter: OTLPTraceExporterGrpc | OTLPTraceExporterHttp | OTLPTraceExporterProto | ConsoleSpanExporter;
  let metricsExporter:
    | OTLPMetricExporterGrpc
    | OTLPMetricExporterHttp
    | OTLPMetricExporterProto
    | ConsoleMetricExporter;

  logger.debug('Deciding on exporters');
  switch (tracingConfig.exporter) {
    case OpenTelemetryExporter.HTTP:
      traceExporter = new OTLPTraceExporterHttp({
        url: tracingConfig.url,
      });
      break;
    case OpenTelemetryExporter.PROTOBUFF:
      traceExporter = new OTLPTraceExporterProto({
        url: tracingConfig.url,
      });
      break;
    case OpenTelemetryExporter.GRPC:
      traceExporter = new OTLPTraceExporterGrpc({
        url: tracingConfig.url,
      });
      break;
    default:
      traceExporter = new ConsoleSpanExporter();
      break;
  }

  switch (metricsConfig.exporter) {
    case OpenTelemetryExporter.HTTP:
      metricsExporter = new OTLPMetricExporterHttp({
        url: metricsConfig.url,
      });
      break;
    case OpenTelemetryExporter.PROTOBUFF:
      metricsExporter = new OTLPMetricExporterProto({
        url: metricsConfig.url,
      });
      break;
    case OpenTelemetryExporter.GRPC:
      metricsExporter = new OTLPMetricExporterGrpc({
        url: metricsConfig.url,
      });
      break;
    default:
      metricsExporter = new ConsoleMetricExporter();
      break;
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: API_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: env.VERSION,
      [SEMRESATTRS_HOST_NAME]: os.hostname(),
    }),
    traceExporter: tracingConfig.enabled ? traceExporter : undefined,
    sampler: new AlwaysOnSampler(),
    spanProcessors: tracingConfig.enabled ? [new BatchSpanProcessor(traceExporter)] : undefined,
    metricReader: metricsConfig.enabled
      ? new PeriodicExportingMetricReader({
          exporter: metricsExporter,
          exportIntervalMillis: metricsConfig.interval,
        })
      : undefined,
    instrumentations: [new HttpInstrumentation(), new FsInstrumentation()],
  });

  logger.info('Opentelemetry SDK ready');
  sdk.start();
}

/**
 * Validates and parses the API configuration, if provided. If no config file is found, fallback to default values
 * is used. Once the API configuration is validated, the Opentelemetry SDK is started with the parsed configuration.
 * If the validation fails, the process will exit with code 0.
 * @async
 * @returns {Promise<ApiConfiguration>} The validated and parsed API configuration.
 */
export async function getApiConfiguration(): Promise<ApiConfiguration> {
  logger.info(`Using Cache-Nest ${env.VERSION}`);
  let apiConfig = merge({}, API_CONFIG_DEFAULTS) as ApiConfiguration;

  try {
    logger.debug(`Searching for configuration file ${API_CONFIG_FILENAME} as path ${API_CONFIG_FILEPATH}`);
    const files = await fse.readdir(path.resolve(API_CONFIG_FILEPATH));
    const configFile = files.find((file) => path.parse(file).name === API_CONFIG_FILENAME);

    // If a config file is provided, we merge the options and validate the configuration as a whole.
    // Should this fail we just exit the process and call it a day.
    if (configFile) {
      const configFilePath = path.parse(configFile);
      logger.verbose(`Found file ${path.format(configFilePath)}`);

      switch (configFilePath.ext) {
        case '.yml':
        case '.yaml ':
          logger.debug('Reading YAML configuration file');
          const contents = await fse.readFile(path.format(configFilePath), 'utf-8');
          apiConfig = merge({}, apiConfig, jsYaml.load(contents));
          break;
        case '.json':
          logger.debug('Reading JSON configuration file');
          apiConfig = merge({}, apiConfig, await fse.readJSON(path.format(configFilePath)));
          break;
        default:
          logger.warn(
            `Found unsupported file extension ${configFilePath.ext}. The supported formats are YML, YAML and JSON.`,
          );
          break;
      }
    }
  } catch (error) {
    logger.error(
      `Failed to read API configuration file at ${path.join(API_CONFIG_FILEPATH, API_CONFIG_FILENAME)}: ${error}`,
    );
    process.exit(0);
  }

  logger.debug('Validating API configuration');
  const validated = await ApiConfigurationValidator.safeParseAsync(apiConfig);
  if (!validated.success) {
    const errorMessage = validated.error.errors.reduce(
      (message, error) => message.concat(`\n  ${error.path.join('.')}: ${error.code}`),
      '',
    );
    logger.error(`Invalid API configuration: ${errorMessage}`);
    process.exit(0);
  } else {
    await startSDK(validated.data.tracing, validated.data.metrics);

    logger.info('API setup complete');
    return validated.data as ApiConfiguration;
  }
}
