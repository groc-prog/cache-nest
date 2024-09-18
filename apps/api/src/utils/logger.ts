import { trace } from '@opentelemetry/api';
import { env } from 'bun';
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

export default createLogger({
  level: env.LOG_LEVEL || 'http',
  format: format.combine(format.timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' }), format.json(), traceFormat()),
  defaultMeta: {
    service: 'cache-nest',
  },
  transports: [new transports.Console()],
});
