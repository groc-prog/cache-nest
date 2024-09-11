import { env } from 'bun';
import { merge } from 'lodash-es';

import type { ElysiaApp } from '@/index';

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
    .onAfterResponse(({ logger, startTime, request, set, headers, server }) => {
      const durationHrTime = process.hrtime(startTime);
      const duration = durationHrTime[0] * 1e3 + durationHrTime[1] / 1e6;

      let payload = {
        method: request.method,
        url: request.url,
        status: set.status,
        contentLength: headers['content-length'] || 0,
        durationMs: duration.toFixed(3),
      };

      if (env.NODE_ENV !== 'development')
        payload = merge({}, payload, {
          referrer: request.referrer,
          ip: server?.requestIP(request),
          userAgent: headers['user-agent'],
        });

      logger.http(`${request.method} ${request.url}`, payload);
    });

  return app;
};
