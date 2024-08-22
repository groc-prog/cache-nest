const { resolve } = require('node:path');

const project = resolve(process.cwd(), 'tsconfig.json');

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['plugin:import/recommended', 'eslint:recommended', 'airbnb-typescript/base', 'prettier', 'turbo'],
  env: {
    node: true,
  },
  parserOptions: {
    project,
  },
  settings: {
    'import/resolver': { node: {} },
  },
  ignorePatterns: ['.*.js', 'node_modules/', 'dist/'],
  overrides: [
    {
      files: ['*.js?(x)', '*.ts?(x)'],
    },
  ],
};
