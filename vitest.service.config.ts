import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./service/wrangler.jsonc" },
      miniflare: {
        bindings: {
          SERVICE_MODE: "local",
          SERVICE_ORIGIN: "http://127.0.0.1:5173",
          SERVICE_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-characters",
          TEST_MIGRATIONS: await readD1Migrations("./service/migrations"),
        },
      },
    }),
  ],
  test: {
    include: ["test/service/**/*.test.ts"],
    setupFiles: ["./test/service/setup.ts"],
    maxWorkers: 1,
    isolate: false,
  },
}));
