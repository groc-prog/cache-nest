import { cors } from '@elysiajs/cors';
import { opentelemetry } from '@elysiajs/opentelemetry';
import { swagger } from '@elysiajs/swagger';
import { trace } from '@opentelemetry/api';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { autoload } from 'elysia-autoload';
import { merge } from 'lodash-es';

import { Driver } from '@cache-nest/types';

import { type BaseDriver, FileSystemDriver, MemoryDriver } from '@/drivers';
import { getApiConfiguration } from '@/setup/configuration-setup';
import { ApiError } from '@/utils/errors';
import globalLogger from '@/utils/logger';

const apiConfiguration = await getApiConfiguration();
const cacheDrivers: Record<Driver, BaseDriver> = {
  [Driver.MEMORY]: new MemoryDriver(apiConfiguration.drivers.memory),
  [Driver.FILE_SYSTEM]: new FileSystemDriver(apiConfiguration.drivers.fileSystem),
};

for (const driver in cacheDrivers) {
  if (apiConfiguration.server.clustering.enabled && driver === Driver.MEMORY) {
    globalLogger.warning('Memory driver will be disabled when using clustering mode');
    continue;
  }

  await cacheDrivers[driver as Driver].init();
}

globalLogger.debug('Setting up server plugins and routes');
const elysiaServer = new Elysia()
  .decorate('configuration', apiConfiguration)
  .decorate('logger', globalLogger)
  .decorate('drivers', cacheDrivers)
  .derive(() => ({
    startTime: process.hrtime(),
  }))
  .error({
    ApiError,
  })
  .onError(({ error, code }) => {
    const spanContext = trace.getActiveSpan()?.spanContext();
    return {
      message: code === 'VALIDATION' ? JSON.parse(error.message) : error.message,
      detail: code === 'ApiError' ? error.detail : undefined,
      status: code === 'ApiError' ? error.status : undefined,
      stack: env.NODE_ENV === 'development' ? error.stack : undefined,
      traceId: spanContext ? spanContext.traceId : undefined,
      spanId: spanContext ? spanContext.spanId : undefined,
    };
  })
  .onAfterResponse(async ({ logger, request, response, set, headers, server, path, startTime }) => {
    const durationHrTime = process.hrtime(startTime);
    const duration = durationHrTime[0] * 1e3 + durationHrTime[1] / 1e6;
    let payload = {
      method: request.method,
      url: request.url,
      status: set.status,
      handlerDurationMs: duration.toFixed(4),
      contentLength: response ? Buffer.byteLength(JSON.stringify(response)) : '-',
    };
    if (env.NODE_ENV !== 'development')
      payload = merge({}, payload, {
        referrer: request.referrer,
        ip: server?.requestIP(request),
        userAgent: headers['user-agent'],
      });
    logger.http(`${request.method} ${path}`, payload);
  })
  .onBeforeHandle(({ path, configuration, logger }) => {
    if (!configuration.server.clustering.enabled || !path.includes('cache/memory')) return;

    // The client tries to access the memory driver in clustering mode, which
    // we have to prevent since the memory driver does not have shared memory.
    logger.warn(
      'With clustering mode enabled, the memory driver is not available. Disable clustering or use another driver.',
    );
    throw new ApiError({
      message: 'Memory driver not available',
      detail:
        'With clustering mode enabled, the memory driver is not available. Disable clustering or use another driver.',
      status: 503,
    });
  })
  .use(
    cors({
      origin: apiConfiguration.server.cors.origin,
      methods: ['POST', 'GET', 'DELETE'],
    }),
  )
  .use(
    await autoload({
      prefix: '/api',
    }),
  );

if (apiConfiguration.tracing.enabled) elysiaServer.use(opentelemetry());
if (apiConfiguration.server.enableSwagger)
  elysiaServer.use(
    swagger({
      documentation: {
        info: {
          title: 'Cache-Nest API',
          description: 'Complete development API documentation for Cache-Nest',
          version: env.VERSION || 'Development',
          contact: {
            name: 'Marc Troisner',
            email: 'marc.troisner@gmail.com',
            url: 'https://github.com/groc-prog/cache-nest',
          },
          license: {
            name: 'MIT License',
            url: 'https://opensource.org/licenses/MIT',
          },
        },
        tags: [{ name: 'Server', description: 'General information about the state and configuration of the server.' }],
      },
    }),
  );

elysiaServer.listen(
  {
    port: apiConfiguration.server.port,
    hostname: apiConfiguration.server.host,
    reusePort: true,
  },
  (bunServer) => {
    globalLogger.info(`🚀 Server ready at ${bunServer.hostname}:${bunServer.port}`);
  },
);

export type App = typeof elysiaServer;
