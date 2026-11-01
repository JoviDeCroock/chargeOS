import { execFileSync } from "node:child_process";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "-p",
    "service/tsconfig.native.json",
  ],
  { cwd: root, stdio: "inherit" },
);
cpSync(
  new URL("../service/migrations", import.meta.url),
  new URL("../dist/native-service/service/migrations", import.meta.url),
  { recursive: true },
);
