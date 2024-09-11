import { Elysia } from 'elysia';

import { getApiConfiguration } from '@/setup';
import logger from '@/utils/logger';

const configuration = await getApiConfiguration();

logger.info('Starting server');
new Elysia()
  .get('/', () => ({ msg: 'Hello Elysia' }))
  .listen(
    {
      port: configuration.server.port,
      hostname: configuration.server.host,
    },
    (bunServer) => {
      logger.info(`Server started on ${bunServer.hostname}:${bunServer.port}`);
    },
  );
