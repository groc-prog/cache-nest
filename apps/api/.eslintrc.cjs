/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@cache-nest/eslint-config/node.js'],
  parserOptions: {
    project: 'tsconfig.json',
  },
};
