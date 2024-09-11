import type { ElysiaApp } from '@/index';
import { tracer } from '@/utils/opentelemetry';

/**
 * Plugin for API token authentication. THe token is expected to be included in the
 * `Authorization` header in the format of `Bearer <token>`. If the token is not found or
 * invalid, a `401 response` is returned.
 *
 * If API key authentication is disabled, this method is a no-op.
 * @param {ElysiaApp} app - The Elysia application instance.
 * @returns {ElysiaApp} The app with the plugin applied to it.
 */
export const authenticationPlugin = (app: ElysiaApp): ElysiaApp =>
  app.onBeforeHandle(({ headers, error, configuration }) => {
    if (!configuration.server.authentication.enabled) return;

    tracer.startActiveSpan('plugin/authentication', (span) => {
      const authHeader = headers.authorization?.split(' ');
      if (!authHeader) {
        span.end();
        return error(401, {
          message: 'Missing authorization',
          cause: 'A API token is required to access any content.',
        });
      }

      const apiToken = authHeader[1];
      if (!apiToken || !configuration.server.authentication.apiKeys.includes(apiToken)) {
        span.end();
        return error(401, {
          message: 'Invalid API token',
          cause: 'The provided API token is invalid.',
        });
      }

      span.end();
      return;
    });
  });
