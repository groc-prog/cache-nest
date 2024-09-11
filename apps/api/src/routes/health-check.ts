import type { ElysiaApp } from '@/index';

const router = (app: ElysiaApp) =>
  app.group('/server', (group) =>
    group.get('', ({ configuration }) => {
      return {
        message: 'ok',
        configuration,
      };
    }),
  );

export default router;
