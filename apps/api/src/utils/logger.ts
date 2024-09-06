import { trace } from '@opentelemetry/api';
import { format, transports, createLogger } from 'winston';

const traceFormat = format((info) => {
  const span = trace.getActiveSpan();
  if (!span) return info;

  const context = span.spanContext();
  info.traceId = context.traceId;
  info.spanId = context.spanId;
  info.traceFlags = context.traceFlags;
  return info;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'http',
  format: format.combine(
    traceFormat(),
    format.json(),
    format.colorize(),
    format.timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' }),
  ),
  defaultMeta: {
    service: 'cache-nest',
  },
  transports: [new transports.Console()],
});

export default logger;
