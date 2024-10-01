import { t } from 'elysia';

import { Driver, Policy } from '@cache-nest/types';

import type { App } from '@/index';
import { ApiError } from '@/utils/errors';
import { ErrorResponseType, IdentifierType } from '@/utils/swagger';

export default (app: App) =>
  app.post(
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
        if (!query.force && !hasBeenSet) throw new ApiError('Cache already exists', 409);

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
        force: t.Boolean({
          default: false,
          description: 'Whether to overwrite existing entries.',
        }),
      }),
      body: t.Object({
        identifier: t.Recursive(IdentifierType, {
          description: 'The cache identifier under which it will be registered.',
        }),
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
              t.Array(t.Recursive(IdentifierType), {
                description: 'A list of identifiers which can be used to manually invalidate the cache.',
              }),
            ),
          }),
        ),
      }),
      response: {
        201: t.Null(),
        409: ErrorResponseType,
        500: ErrorResponseType,
      },
    },
  );
