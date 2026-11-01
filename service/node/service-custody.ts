import { lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { syncRecoveryDirectory, writePrivateRecoveryFile } from "./recovery-files.js";
import { withNativeRecoveryCustody } from "./recovery-review.js";

async function absent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Native service custody requires a stopped-process audit");
}
/** The two-lock ordering
 * makes a concurrent normal startup either visible here or refuse lifecycle.
 * PID metadata is diagnostic only: never auto-reap across container namespaces. */
export async function withNativeStoppedServiceCustody<T>(
  directory: string,
  run: () => Promise<T>,
): Promise<T> {
  return withNativeRecoveryCustody(directory, async () => {
    await absent(join(directory, ".service-runtime"));
    return run();
  });
}
/** Normal main holds this independently of SMTP/recovery custody until every
 * asynchronous HTTP handler has drained and SQLite has actually closed. */
export async function acquireNativeServiceCustody(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Native service custody requires a private directory");
  const lock = join(directory, ".service-runtime");
  await mkdir(lock, { mode: 0o700 });
  const created = await lstat(lock);
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= (async () => {
      const current = await lstat(lock).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (
        current?.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === created.dev &&
        current.ino === created.ino
      ) {
        await rm(lock, { recursive: true });
        await syncRecoveryDirectory(directory);
      }
    })());
  try {
    // Claim first, then check recovery: a stopped-source operator checks the
    // inverse order (lifecycle first, then runtime) before touching its source.
    await absent(join(directory, ".recovery-lifecycle"));
    await writePrivateRecoveryFile(
      join(lock, "operator.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await syncRecoveryDirectory(directory);
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
