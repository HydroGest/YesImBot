import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["references/**", "node_modules/**"],
  },
});
