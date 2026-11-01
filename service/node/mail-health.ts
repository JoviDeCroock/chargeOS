import { constants, lstatSync } from "node:fs";
import { open, lstat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeFile } from "./runtime-files.js";

export const MAIL_HEALTH_FILE = "/tmp/chargeos-mail-ready";
export function mailWorkerHealthy(path = MAIL_HEALTH_FILE, now = Date.now()): boolean {
  try {
    const info = lstatSync(path);
    const value: unknown = JSON.parse(readRuntimeFile(path, 128));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).join() !== "pid"
    )
      return false;
    const pid = (value as { pid?: unknown }).pid;
    if (
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid < 1 ||
      info.mtimeMs > now + 1000 ||
      now - info.mtimeMs > 60000
    )
      return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Volatile liveness only, never authentication, recovery or mailbox proof. */
export function mailHeartbeat(path: string) {
  let file: FileHandle | undefined, identity: { ino: number; dev: number } | undefined;
  return {
    async pulse() {
      if (!file) {
        file = await open(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        const info = await file.stat();
        identity = { ino: info.ino, dev: info.dev };
        await file.writeFile(JSON.stringify({ pid: process.pid }));
      }
      const now = new Date();
      await file.utimes(now, now);
    },
    async close() {
      await file?.close();
      if (!identity) return;
      const current = await lstat(path).catch(() => undefined);
      if (current?.ino === identity.ino && current.dev === identity.dev) await unlink(path);
    },
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  process.exitCode = mailWorkerHealthy() ? 0 : 1;
