import { Server } from 'hyper-express';

import { getApiConfiguration } from './setup.js';
import logger from './utils/logger.js';
import { tracer } from './utils/opentelemetry.js';

const configuration = await getApiConfiguration();

const server = new Server();

server.get('/', (_, res) => {
  tracer.startActiveSpan('testSpan', (span) => {
    logger.info('with trace');
    res.json({ msg: 'Hello World' });
    span.end();
  });
});

server.get('/without', (_, res) => {
  logger.info('without trace');
  res.json({ msg: 'Hello World' });
});

logger.info('Starting server');
server.listen(configuration.server.port, configuration.server.host).then(() => {
  logger.info(`Server started on ${configuration.server.host}:${configuration.server.port}`);
});
