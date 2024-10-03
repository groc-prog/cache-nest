import { t } from 'elysia';

import { Driver, Policy } from '@cache-nest/types';

import type { App } from '@/index';
import { authenticationPlugin } from '@/plugins/authentication';
import { ApiError } from '@/utils/errors';
import { IdentifierType } from '@/utils/swagger';

export default (app: App) =>
  app.use(authenticationPlugin).post(
    '',
    async ({ body, params, drivers, logger, set }) => {
      try {
        await drivers[Driver.MEMORY].invalidate(body.identifiers, params.policy);

        set.status = 204;
        return null;
      } catch (err) {
        logger.error('Failed to create new cache', err);
        if (err instanceof ApiError) throw err;
        throw new ApiError();
      }
    },
    {
      detail: {
        tags: ['Cache'],
        summary: 'Invalidates and evicts caches',
        description: `Evicts all caches which define the one of the provided invalidation identifiers.
      `,
      },
      params: t.Object({
        policy: t.Enum(Policy, {
          description: 'The eviction policy the cache entry will use.',
        }),
      }),
      body: t.Object({
        identifiers: t.Array(IdentifierType, {
          description: 'List of invalidation identifiers',
        }),
      }),
      response: {
        204: t.Null(),
      },
    },
  );
