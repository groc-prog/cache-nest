import { t } from 'elysia';

import { Driver, Policy } from '@cache-nest/types';

import type { App } from '@/server';

const PolicyResourceUsage = t.Object({
  count: t.Number({
    description: 'Number of caches stored by the policy.',
  }),
  relative: t.Number({
    description: 'The relative (%) amount of bytes used by the policy.',
  }),
  total: t.Number({
    description: 'The total number of bytes used by the policy.',
  }),
});

export default (app: App) =>
  app.get(
    '',
    async ({ drivers }) => ({
      [Driver.MEMORY]: await drivers.memory.resourceUsage(),
      [Driver.FILE_SYSTEM]: await drivers.fileSystem.resourceUsage(),
    }),
    {
      detail: {
        tags: ['Server'],
        summary: 'Get API status',
        description: `Returns the status of the API together with the resource usage of different drivers.
      `,
      },
      response: {
        200: t.Object({
          [Driver.MEMORY]: t.Object({
            total: t.Number({
              description: 'The total number of bytes used by the driver.',
            }),
            relative: t.Number({
              description: 'The relative (%) amount of bytes used by the driver.',
            }),
            [Policy.LRU]: PolicyResourceUsage,
            [Policy.MRU]: PolicyResourceUsage,
            [Policy.RR]: PolicyResourceUsage,
            [Policy.LFU]: PolicyResourceUsage,
            [Policy.MFU]: PolicyResourceUsage,
            [Policy.FIFO]: PolicyResourceUsage,
          }),
          [Driver.FILE_SYSTEM]: t.Object({
            total: t.Number({
              description: 'The total number of bytes used by the driver.',
            }),
            relative: t.Number({
              description: 'The relative (%) amount of bytes used by the driver.',
            }),
            [Policy.LRU]: PolicyResourceUsage,
            [Policy.MRU]: PolicyResourceUsage,
            [Policy.RR]: PolicyResourceUsage,
            [Policy.LFU]: PolicyResourceUsage,
            [Policy.MFU]: PolicyResourceUsage,
            [Policy.FIFO]: PolicyResourceUsage,
          }),
        }),
      },
    },
  );
