import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    include: ['test/**/*.{spec,test}.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
    },
  },
});
