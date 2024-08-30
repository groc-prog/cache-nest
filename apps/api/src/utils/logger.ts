import { format, transports, createLogger } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'http',
  format: format.combine(format.json(), format.colorize(), format.timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' })),
  defaultMeta: {
    service: 'cache-nest',
  },
  transports: [new transports.Console()],
});

export default logger;
