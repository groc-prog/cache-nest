import { t } from 'elysia';

import { Driver, Policy } from '@cache-nest/types';

import { authenticationPlugin } from '@/plugins/authentication';
import type { App } from '@/server';
import { ApiError } from '@/utils/errors';
import { ErrorResponseType, IdentifierType } from '@/utils/swagger';

export default (app: App) =>
  app.use(authenticationPlugin).post(
    '',
    async ({ body, params, query, drivers, logger, set }) => {
      try {
        const hasBeenSet = await drivers[Driver.MEMORY].set(
          body.identifier,
          params.policy,
          {
            data: body.data,
            metadata: body.metadata,
            options: body.options,
          },
          query.force,
        );

        if (query.force && !hasBeenSet) throw new ApiError();
        if (!query.force && !hasBeenSet)
          throw new ApiError({
            message: 'Cache already exists',
            detail:
              'A cache with the provided identifier already exists. If you want to overwrite the existing cache, you have to pass the force parameter as true.',
            status: 409,
          });

        set.status = 201;
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
        summary: 'Creates a new cache with the given identifier',
        description: `Generates a new cache entry and registers it for the given identifier. If the cache
        already exists, it will not be generated again unless \`force\` is set to \`true\`.
      `,
      },
      params: t.Object({
        policy: t.Enum(Policy, {
          description: 'The eviction policy the cache entry will use.',
        }),
      }),
      query: t.Object({
        force: t.Optional(
          t.Boolean({
            default: false,
            description: 'Whether to overwrite existing entries.',
          }),
        ),
      }),
      body: t.Object({
        identifier: IdentifierType,
        data: t.Any({
          description: 'The data to cache.',
        }),
        metadata: t.Optional(
          t.Record(t.String(), t.Any(), {
            description:
              'Optional metadata stored with the cache. Can be used to attach any additional data to the cache entry.',
          }),
        ),
        options: t.Optional(
          t.Object({
            ttl: t.Optional(
              t.Number({
                description:
                  'The TTL (time to live) of the cache in milliseconds. If set, the cache will be invalidated and garbage collected after this amount of time, regardless of whether the eviction policy should evict this cache or not. Will never expire if set to `0`.',
                minimum: 0,
              }),
            ),
            invalidatedBy: t.Optional(
              t.Array(IdentifierType, {
                description: 'A list of identifiers which can be used to manually invalidate the cache.',
              }),
            ),
          }),
        ),
      }),
      response: {
        201: t.Null(),
        409: ErrorResponseType,
      },
    },
  );
