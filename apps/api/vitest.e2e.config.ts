import { defineProject, configDefaults } from 'vitest/config';

export default defineProject({
  test: {
    exclude: [...configDefaults.exclude, 'test/**'],
  },
});
