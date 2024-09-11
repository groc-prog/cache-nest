import { cors } from '@elysiajs/cors';
import { opentelemetry } from '@elysiajs/opentelemetry';
import { swagger } from '@elysiajs/swagger';
import { env } from 'bun';
import { Elysia } from 'elysia';

import { getApiConfiguration } from '@/setup';
import logger from '@/utils/logger';
import { tracer } from '@/utils/opentelemetry';

const configuration = await getApiConfiguration();

logger.info('Starting server');
const server = new Elysia()
  .use(
    cors({
      origin: configuration.server.cors.origin,
      methods: ['POST', 'GET', 'DELETE'],
    }),
  )
  .get('/', async () => {
    await tracer.startActiveSpan('test', async (span) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      span.end();
    });

    return { msg: 'Hello Elysia' };
  });

if (configuration.tracing.enabled) server.use(opentelemetry());
if (configuration.server.enableSwagger)
  server.use(
    swagger({
      documentation: {
        info: {
          title: 'Cache-Nest API',
          description: 'Complete development API documentation for Cache-Nest',
          version: env.VERSION || 'Development',
        },
      },
    }),
  );

server.listen(
  {
    port: configuration.server.port,
    hostname: configuration.server.host,
  },
  (bunServer) => {
    logger.info(`Server started on ${bunServer.hostname}:${bunServer.port}`);
  },
);
