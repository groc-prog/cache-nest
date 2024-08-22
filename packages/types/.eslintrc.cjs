/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@cache-nest/eslint-config/package.js'],
  parserOptions: {
    project: 'tsconfig.json',
  },
};
