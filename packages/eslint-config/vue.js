require("@rushstack/eslint-patch/modern-module-resolution");
const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [
    "plugin:vue/vue3-essential",
    "eslint:recommended",
    "@vue/eslint-config-typescript",
    "prettier",
    "turbo",
  ],
  env: {
    browser: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
  },
  ignorePatterns: [".*.js", "node_modules/", "dist/"],
  overrides: [
    {
      files: ["*.js?(x)", "*.ts?(x)"],
    },
    {
      files: ["e2e/**/*.{test,spec}.{js,ts,jsx,tsx}"],
      extends: ["plugin:playwright/recommended"],
    },
  ],
};
