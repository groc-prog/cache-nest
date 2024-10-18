import type { App } from '@/server';
import { ApiError } from '@/utils/errors';
import { tracer } from '@/utils/opentelemetry';

/**
 * Plugin for API token authentication. THe token is expected to be included in the
 * `Authorization` header in the format of `Bearer <token>`. If the token is not found or
 * invalid, a `401 response` is returned.
 *
 * If API key authentication is disabled, this method is a no-op.
 * @param {App} app - The Elysia application instance.
 * @returns {App} The app with the plugin applied to it.
 */
export const authenticationPlugin = (app: App): App =>
  app.onBeforeHandle(({ headers, configuration, logger }) => {
    if (!configuration.server.authentication.enabled) return;

    tracer.startActiveSpan('ApiTokenAuthentication', (span) => {
      logger.info('Validating API token');
      const authHeader = headers.authorization?.split(' ');
      if (!authHeader) {
        span.end();
        throw new ApiError({
          message: 'Missing authorization',
          detail: 'A API token is required to access any content.',
          status: 401,
        });
      }

      const apiToken = authHeader[1];
      if (!apiToken || !configuration.server.authentication.apiKeys.includes(apiToken)) {
        span.end();
        throw new ApiError({
          message: 'Invalid API token',
          detail: 'The provided API token is invalid',
          status: 401,
        });
      }

      span.end();
      return;
    });
  });
