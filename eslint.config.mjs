import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: { ...globals.node } } },
  { files: ["**/*.{js,mjs,cjs}"], rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
]);
