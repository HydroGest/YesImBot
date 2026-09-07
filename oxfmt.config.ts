import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".omp/**",
    ".specify/**",
    "openspec/**",
    "tools/oxlint/anti-slop/**",
    "**/dist/**",
    "**/lib/**",
    "**/node_modules/**",
  ],
  sortImports: {
    newlinesBetween: true,
  },
  sortPackageJson: {
    sortDependencies: true,
    sortDevDependencies: true,
    sortPeerDependencies: true,
    sortScripts: true,
  },
  endOfLine: "lf",
  semi: true,
  printWidth: 160,
  objectWrap: "preserve",
  singleQuote: false,
  insertFinalNewline: true,
  trailingComma: "all",
});
