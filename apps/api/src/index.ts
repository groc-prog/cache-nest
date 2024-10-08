import { cors } from '@elysiajs/cors';
import { opentelemetry } from '@elysiajs/opentelemetry';
import { swagger } from '@elysiajs/swagger';
import { trace } from '@opentelemetry/api';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { autoload } from 'elysia-autoload';
import { merge } from 'lodash-es';

import { Driver } from '@cache-nest/types';

import type { BaseDriver } from '@/drivers/base';
import { MemoryDriver } from '@/drivers/memory';
import { getApiConfiguration } from '@/setup';
import { ApiError } from '@/utils/errors';
import globalLogger from '@/utils/logger';

const apiConfiguration = await getApiConfiguration();
// @ts-expect-error
const cacheDrivers: Record<Driver, BaseDriver> = {
  [Driver.MEMORY]: new MemoryDriver(apiConfiguration.drivers.memory),
};

for (const driver in cacheDrivers) await cacheDrivers[driver as Driver].init();

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
  },
  (bunServer) => {
    globalLogger.info(`🚀 Server ready at ${bunServer.hostname}:${bunServer.port}`);
  },
);

export type App = typeof elysiaServer;
