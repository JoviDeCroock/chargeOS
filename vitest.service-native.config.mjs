import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "cloudflare:test": fileURLToPath(new URL("./test/native/env.mjs", import.meta.url)) },
  },
  test: {
    include: ["test/service/**/*.test.ts", "test/native/*.test.mjs"],
    setupFiles: ["./test/native/setup.mjs"],
    maxWorkers: 1,
    isolate: false,
  },
});
