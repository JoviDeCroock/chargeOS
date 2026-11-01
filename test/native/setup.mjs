import { beforeAll, afterAll } from "vitest";
import { initialize, dispose } from "./env.mjs";
beforeAll(initialize);
afterAll(dispose);
