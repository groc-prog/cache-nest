import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    exclude: [...configDefaults.exclude, 'test/**'],
    root: '.',
    coverage: {
      provider: 'v8',
    },
  },
});
