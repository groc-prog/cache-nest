/* eslint-env node */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@cache-nest/eslint-config/vue.js"],
  parserOptions: {
    project: "tsconfig.json",
  },
};
