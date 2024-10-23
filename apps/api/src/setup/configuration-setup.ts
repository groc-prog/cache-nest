import { env } from 'bun';
import fse from 'fs-extra';
import jsYaml from 'js-yaml';
import { merge } from 'lodash-es';
import os from 'os';
import path from 'path';
import { cwd } from 'process';
import { z } from 'zod';

import { type UnparsedApiConfiguration, type ApiConfiguration, OpenTelemetryExporter } from '@cache-nest/types';

import logger from '@/utils/logger';

const API_CONFIGURATION_CACHE_PATH = '.cache-nest-configuration-cache.json';
const API_CONFIG_FILENAME = 'cache-nest-config';
const API_CONFIG_FILE_PATH = env.NODE_ENV !== 'production' ? '.' : '/etc';
const API_CONFIG_DEFAULTS: UnparsedApiConfiguration = {
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
    clustering: {
      enabled: false,
      clusters: 'auto',
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

const NumberOrPercentageValidator = z.union([
  z.number().superRefine((value, ctx) => {
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
  }),
  z
    .string()
    .superRefine((value, ctx) => {
      const percentage = parseFloat(value.replace('%', ''));

      if (isNaN(percentage))
        return ctx.addIssue({
          code: z.ZodIssueCode.invalid_type,
          expected: 'number',
          received: 'string',
          message: 'maxSize must be a number or a percentage string in the format {number}%',
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
    })
    .transform((value) => {
      const percentage = parseFloat(value.replace('%', ''));
      return Math.floor((percentage / 100) * os.totalmem());
    }),
]);

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
    clustering: z.object({
      enabled: z.boolean(),
      clusters: z
        .union([z.number(), z.literal('auto')])
        .refine((value) => {
          if (value === 'auto') return true;
          return value <= navigator.hardwareConcurrency;
        }, "Can not spawn more clusters than available CPU's")
        .transform((value) => {
          if (value === 'auto') return navigator.hardwareConcurrency;
          return value;
        }),
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
 * Validates and parses the API configuration, if provided. If no config file is found, fallback to default values
 * is used. Once the API configuration is validated, the Opentelemetry SDK is started with the parsed configuration.
 * If the validation fails, the process will exit with code 0.
 * @async
 * @param {boolean} [noCache=false] - Whether to use a cached version of the configuration if found.
 * @returns {Promise<ApiConfiguration>} The validated and parsed API configuration.
 */
export async function getApiConfiguration(noCache: boolean = false): Promise<ApiConfiguration> {
  logger.info(`Using Cache-Nest ${env.VERSION}`);
  const cacheFilePath = path.join(cwd(), API_CONFIGURATION_CACHE_PATH);

  if (noCache) {
    try {
      await fse.remove(cacheFilePath);
    } catch (err) {
      logger.error('Failed to remove cached configuration file', err);
    }
  } else {
    try {
      logger.verbose('Checking for configuration cache');
      return (await fse.readJSON(cacheFilePath)) as ApiConfiguration;
    } catch (err) {
      logger.verbose('No cached configuration file found', err);
    }
  }

  let apiConfig = merge({}, API_CONFIG_DEFAULTS) as UnparsedApiConfiguration;

  try {
    logger.debug(`Searching for configuration file ${API_CONFIG_FILENAME} as path ${API_CONFIG_FILE_PATH}`);
    const files = await fse.readdir(path.resolve(API_CONFIG_FILE_PATH));
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
  } catch (err) {
    logger.error(
      `Failed to read API configuration file at ${path.join(API_CONFIG_FILE_PATH, API_CONFIG_FILENAME)}: ${err}`,
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
    try {
      logger.verbose('Caching configuration file');
      await fse.writeJSON(cacheFilePath, validated.data);
    } catch (err) {
      logger.info('Failed to cache configuration file', err);
    }
    logger.info('Setup complete');
    return validated.data as ApiConfiguration;
  }
}
