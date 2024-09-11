import { omit } from 'lodash-es';

import type { ElysiaApp } from '@/index';

const router = (app: ElysiaApp) =>
  app.group('/server', (group) =>
    group.get('/configuration', ({ configuration }) => {
      throw new Error('fuck');
      return omit(configuration, ['server.authentication']);
    }),
  );

export default router;
