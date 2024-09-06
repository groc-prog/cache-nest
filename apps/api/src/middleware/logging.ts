import { context } from '@opentelemetry/api';
import auth from 'basic-auth';
import type { Request, Response, MiddlewareNext } from 'hyper-express';
import { merge } from 'lodash-es';

import logger from '../utils/logger.js';
import { tracer } from '../utils/opentelemetry.js';

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
      const durationHrTime = process.hrtime(request.locals.duration);
      const duration = durationHrTime[0] * 1e3 + durationHrTime[1] / 1e6;

      let payload = {
        method: request.method,
        url: request.url,
        status: response.statusCode,
        contentLength: response.getHeader('Content-Length') || 0,
        durationMs: duration.toFixed(3),
      };

      if (process.env.NODE_ENV !== 'development')
        payload = merge({}, payload, {
          ip: request.ip,
          authenticatedUser: auth(request) || '-',
          protocol: `HTTP/${request.protocol}`,
          referrer: request.headers.referer || '-',
          userAgent: request.headers['user-agent'],
        });

      logger.http(`${request.method} ${request.url}`, payload);
    });

    span.end();
    context.with(currentContext, next);
  });
}
