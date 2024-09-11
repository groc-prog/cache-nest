import { opentelemetry } from '@elysiajs/opentelemetry';
import { Elysia } from 'elysia';

import { getApiConfiguration } from '@/setup';
import logger from '@/utils/logger';

import { tracer } from './utils/opentelemetry';

const configuration = await getApiConfiguration();

logger.info('Starting server');
new Elysia()
  .use(opentelemetry())
  .get('/', async () => {
    await tracer.startActiveSpan('test', async (span) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      span.end();
    });

    return { msg: 'Hello Elysia' };
  })
  .listen(
    {
      port: configuration.server.port,
      hostname: configuration.server.host,
    },
    (bunServer) => {
      logger.info(`Server started on ${bunServer.hostname}:${bunServer.port}`);
    },
  );
