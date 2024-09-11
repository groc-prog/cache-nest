import { env } from 'bun';
import { merge } from 'lodash-es';
import { Stream } from 'stream';

import type { ElysiaApp } from '@/index';
import { tracer } from '@/utils/opentelemetry';

/**
 * Plugin for request logging.
 * @param {ElysiaApp} app - The Elysia application instance.
 * @returns {ElysiaApp} The app with the plugin applied to it.
 */
export const loggingPlugin = (app: ElysiaApp): ElysiaApp => {
  app
    .derive(() => ({
      startTime: process.hrtime(),
    }))
    .onAfterResponse(async ({ logger, startTime, request, response, set, headers, server }) => {
      tracer.startActiveSpan('plugin/logger', (span) => {
        const durationHrTime = process.hrtime(startTime);
        const duration = durationHrTime[0] * 1e3 + durationHrTime[1] / 1e6;

        // Calculate content length since Elysia does not expose the header
        const contentLength = response instanceof Stream ? 0 : Buffer.byteLength(JSON.stringify(response));

        let payload = {
          method: request.method,
          url: request.url,
          status: set.status,
          contentLength,
          handlerDurationMs: duration.toFixed(4),
        };

        if (env.NODE_ENV !== 'development')
          payload = merge({}, payload, {
            referrer: request.referrer,
            ip: server?.requestIP(request),
            userAgent: headers['user-agent'],
          });

        logger.http(`${request.method} ${request.url}`, payload);
        span.end();
      });
    });

  return app;
};
