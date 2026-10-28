import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const origin = process.argv[2] ?? "http://127.0.0.1:5173";
const url = new URL(origin);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.origin !== origin
)
  throw new Error("Use a loopback HTTP origin without a path");
await writeFile(
  new URL("../service/.dev.vars", import.meta.url),
  `SERVICE_MODE=local\nSERVICE_ORIGIN=${origin}\nSERVICE_AUTH_SECRET=${randomBytes(48).toString("base64url")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log("Created local service configuration. Existing configuration is never overwritten.");
