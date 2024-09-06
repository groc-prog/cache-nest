import { context } from '@opentelemetry/api';
import auth from 'basic-auth';
import type { Request, Response, MiddlewareNext } from 'hyper-express';

import logger from '../utils/logger.js';
import { tracer } from '../utils/opentelemetry.js';

/**
 * Returns a colorized status code based on the HTTP status code.
 * The following colors are used:
 * - 2xx: Green
 * - 3xx: Cyan
 * - 4xx: Yellow
 * - 5xx: Red
 * - Other: Default color
 *
 * @private
 * @param {number} statusCode - The HTTP status code.
 * @returns {string} The colorized status code.
 */
function getStatusColor(statusCode: number): string {
  if (statusCode >= 500) return `\x1b[31m${statusCode}\x1b[0m`;
  if (statusCode >= 400) return `\x1b[33m${statusCode}\x1b[0m`;
  if (statusCode >= 300) return `\x1b[36m${statusCode}\x1b[0m`;
  if (statusCode >= 200) return `\x1b[32m${statusCode}\x1b[0m`;
  return `\x1b[0m${statusCode}\x1b[0m`;
}

/**
 * Logs the response at the end of a request. If the environment is `development`, the log will be in a more concise format.
 * Otherwise, it will be in the Apache Common Log Format.
 *
 * @param {Request} request - The request object.
 * @param {Response} response - The response object.
 * @param {MiddlewareNext} next - The next middleware function.
 */
export function logging(request: Request, response: Response, next: MiddlewareNext) {
  const currentContext = context.active();

  tracer.startActiveSpan('middleware/logging', (span) => {
    // Track the start time of the request and define the used log format.
    request.locals.duration = process.hrtime();

    response.on('close', () => {
      const format =
        process.env.NODE_ENV === 'development'
          ? `${request.method} ${request.url} %statusCode ${response.getHeader('Content-Length') || 0} - %duration ms`
          : `${request.ip} - ${auth(request) || '-'} [${new Date().toUTCString()}] "${request.method} ${request.url} HTTP/${request.protocol}" %statusCode ${response.getHeader('Content-Length') || 0} "${request.headers.referer || '-'}" "${request.headers['user-agent']}"`;

      const durationHrTime = process.hrtime(request.locals.duration);
      const duration = durationHrTime[0] * 1e3 + durationHrTime[1] / 1e6;

      const logMessage = format
        .replace('%statusCode', response.statusCode ? getStatusColor(response.statusCode) : '-')
        .replace('%duration', duration.toFixed(2));

      logger.http(logMessage);
    });

    span.end();
    context.with(currentContext, next);
  });
}
