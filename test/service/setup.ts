import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { ServiceEnv } from "../../service/auth.js";
declare module "cloudflare:test" {
  interface ProvidedEnv extends ServiceEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}
beforeAll(async () => {
  await applyD1Migrations(env.SERVICE_DB, env.TEST_MIGRATIONS);
});
