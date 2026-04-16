import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.omx/**", "**/node_modules/**", "**/ref-duckduckgo-mcp/**"],
  },
});
