import { t } from 'elysia';

import { Driver, Policy } from '@cache-nest/types';

import type { App } from '@/index';
import { authenticationPlugin } from '@/plugins/authentication';
import { ApiError } from '@/utils/errors';
import { ErrorResponseType, IdentifierType } from '@/utils/swagger';

export default (app: App) =>
  app.use(authenticationPlugin).post(
    '',
    async ({ drivers, body, query, params, logger }) => {
      try {
        const cache = await drivers[Driver.MEMORY].get(body.identifier, params.policy);
        if (cache === null)
          throw new ApiError({
            message: 'Cache not found',
            detail: 'The requested cache is either expired, has been evict or does not exist',
            status: 404,
          });

        return {
          data: cache.data,
          metadata: query.include?.includes('metadata') ? cache.metadata : undefined,
          options: query.include?.includes('options') ? cache.options : undefined,
          createdAt: query.include?.includes('timestamp') ? cache.ctime : undefined,
          updatedAt: query.include?.includes('timestamp') ? cache.atime : undefined,
        };
      } catch (err) {
        logger.error('Failed to create new cache', err);
        if (err instanceof ApiError) throw err;
        throw new ApiError();
      }
    },
    {
      detail: {
        tags: ['Cache'],
        summary: 'Returns an existing cache with the given identifier',
        description: `Returns the existing cache for the given identifier. If the cache does not exist, a 404 response
      is returned instead.
    `,
      },
      params: t.Object({
        policy: t.Enum(Policy, {
          description: 'The eviction policy the cache entry will use.',
        }),
      }),
      query: t.Object({
        include: t.Optional(
          t.Array(t.Union([t.Literal('timestamp'), t.Literal('metadata'), t.Literal('options')]), {
            description: 'A list of additional properties returned with the cached data.',
          }),
        ),
      }),
      body: t.Object({
        identifier: IdentifierType,
      }),
      response: {
        200: t.Object({
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
          createdAt: t.Optional(
            t.Number({
              description: 'Unix timestamp recording the creation of the cache.',
            }),
          ),
          updatedAt: t.Optional(
            t.Number({
              description: 'Unix timestamp recording the last update to the cache.',
            }),
          ),
        }),
        404: ErrorResponseType,
      },
    },
  );
