import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    root: '.',
    coverage: {
      provider: 'v8',
    },
  },
});
