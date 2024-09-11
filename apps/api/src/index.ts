import { cors } from '@elysiajs/cors';
import { opentelemetry } from '@elysiajs/opentelemetry';
import { swagger } from '@elysiajs/swagger';
import { env } from 'bun';
import { Elysia } from 'elysia';

import { loggingPlugin } from '@/plugins/logger';
import serverRoutes from '@/routes/server';
import { getApiConfiguration } from '@/setup';
import logger from '@/utils/logger';

// This might be a pretty hacky way of getting the types to work, but i currently don't
// see a way around it for getting plugins to have the correct typing
export type ElysiaApp = typeof server;

const apiConfiguration = await getApiConfiguration();

logger.debug('Setting up server plugins and routes');
// Add global state here so it can be inferred by all plugins/routes/etc using the
// `ElysiaApp` type
const server = new Elysia().decorate('configuration', apiConfiguration).decorate('logger', logger);

server.use(loggingPlugin).use(
  cors({
    origin: apiConfiguration.server.cors.origin,
    methods: ['POST', 'GET', 'DELETE'],
  }),
);

if (apiConfiguration.tracing.enabled) server.use(opentelemetry());
if (apiConfiguration.server.enableSwagger)
  server.use(
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
      },
    }),
  );

server
  .group('/api', (app) => app.use(serverRoutes))
  .listen(
    {
      port: apiConfiguration.server.port,
      hostname: apiConfiguration.server.host,
    },
    (bunServer) => {
      logger.info(`🚀 Server ready at ${bunServer.hostname}:${bunServer.port}`);
    },
  );
