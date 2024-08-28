import { format, transports, createLogger } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'http',
  format: format.combine(
    format((info) => ({ ...info, level: info.level.toUpperCase() }))(),
    format.align(),
    format.colorize(),
    format.timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' }),
    format.printf((info) => {
      if (info.trace_id && info.span_id)
        return `[${info.timestamp}] trace.id=${info.trace_id} span.id=${info.span_id} ${info.level}: ${info.message}`;
      return `[${info.timestamp}] ${info.level}: ${info.message}`;
    }),
  ),
  transports: [new transports.Console()],
});

export default logger;
