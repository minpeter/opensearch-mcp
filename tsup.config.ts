import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "out",
  sourcemap: true,
  minify: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
