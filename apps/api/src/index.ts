import { cors } from '@elysiajs/cors';
import { opentelemetry } from '@elysiajs/opentelemetry';
import { swagger } from '@elysiajs/swagger';
import { trace } from '@opentelemetry/api';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { merge } from 'lodash-es';

import serverRoutes from '@/routes/server';
import { getApiConfiguration } from '@/setup';
import globalLogger from '@/utils/logger';

const apiConfiguration = await getApiConfiguration();

globalLogger.debug('Setting up server plugins and routes');
const elysiaServer = new Elysia()
  .decorate('configuration', apiConfiguration)
  .decorate('logger', globalLogger)
  .derive(() => ({
    startTime: process.hrtime(),
  }))
  .use(
    cors({
      origin: apiConfiguration.server.cors.origin,
      methods: ['POST', 'GET', 'DELETE'],
    }),
  )
  .onError(({ error, code }) => {
    const spanContext = trace.getActiveSpan()?.spanContext();

    return {
      name: error.name,
      message: error.message,
      code,
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
  });

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

elysiaServer
  .group('/api', (app) => app.use(serverRoutes))
  .listen(
    {
      port: apiConfiguration.server.port,
      hostname: apiConfiguration.server.host,
    },
    (bunServer) => {
      globalLogger.info(`🚀 Server ready at ${bunServer.hostname}:${bunServer.port}`);
    },
  );

export type App = typeof elysiaServer;
