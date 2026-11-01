import { afterEach, expect, it, vi } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireNativeServiceCustody,
  withNativeStoppedServiceCustody,
} from "../../service/node/service-custody.ts";
import { withNativeRecoveryCustody } from "../../service/node/recovery-review.ts";

const directories = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "chargeos-service-custody-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("excludes a second main and stopped-source operation while allowing ordinary recovery custody", async () => {
  const path = await directory(),
    lease = await acquireNativeServiceCustody(path),
    run = vi.fn();
  try {
    await expect(acquireNativeServiceCustody(path)).rejects.toThrow();
    await expect(withNativeStoppedServiceCustody(path, run)).rejects.toThrow(
      /stopped-process audit/,
    );
    expect(run).not.toHaveBeenCalled();
    await expect(
      withNativeRecoveryCustody(path, async () => "online snapshot or SMTP"),
    ).resolves.toBe("online snapshot or SMTP");
    const metadata = JSON.parse(
      await readFile(join(path, ".service-runtime/operator.json"), "utf8"),
    );
    expect(metadata.pid).toBe(process.pid);
    expect((await lstat(join(path, ".service-runtime"))).mode & 0o777).toBe(0o700);
    expect((await lstat(join(path, ".service-runtime/operator.json"))).mode & 0o777).toBe(0o600);
  } finally {
    await lease.close();
  }
  await expect(lstat(join(path, ".service-runtime"))).rejects.toThrow();
  await expect(withNativeStoppedServiceCustody(path, async () => "stopped")).resolves.toBe(
    "stopped",
  );
});
it("refuses normal startup throughout stopped-source custody and cleans only its rejected claim", async () => {
  const path = await directory();
  await withNativeStoppedServiceCustody(path, async () => {
    await expect(acquireNativeServiceCustody(path)).rejects.toThrow(/stopped-process audit/);
    await expect(lstat(join(path, ".service-runtime"))).rejects.toThrow();
    expect((await lstat(join(path, ".recovery-lifecycle"))).isDirectory()).toBe(true);
  });
  const lease = await acquireNativeServiceCustody(path);
  await lease.close();
});
it("never grants both normal startup and stopped-source custody in concurrent acquisition", async () => {
  for (let index = 0; index < 20; index++) {
    const path = await directory();
    let entered = false,
      release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const normal = acquireNativeServiceCustody(path).catch(() => null);
    const stopped = withNativeStoppedServiceCustody(path, async () => {
      entered = true;
      await gate;
    }).catch(() => null);
    const lease = await normal;
    release();
    await stopped;
    try {
      expect(!!lease && entered).toBe(false);
    } finally {
      await lease?.close();
    }
  }
});
it("retains a stale claim even when PID metadata appears to identify this process", async () => {
  const path = await directory(),
    lock = join(path, ".service-runtime");
  await mkdir(lock, { mode: 0o700 });
  await writeFile(
    join(lock, "operator.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  await expect(acquireNativeServiceCustody(path)).rejects.toThrow();
  await expect(withNativeStoppedServiceCustody(path, async () => {})).rejects.toThrow(/audit/);
  expect((await lstat(lock)).isDirectory()).toBe(true);
});
it("keeps a replacement inode and refuses shared or linked runtime roots", async () => {
  const path = await directory(),
    lease = await acquireNativeServiceCustody(path),
    lock = join(path, ".service-runtime");
  await rename(lock, join(path, "retained-original"));
  await mkdir(lock, { mode: 0o700 });
  await writeFile(join(lock, "sentinel"), "replacement", { mode: 0o600 });
  await lease.close();
  await lease.close();
  expect(await readFile(join(lock, "sentinel"), "utf8")).toBe("replacement");
  const shared = await directory();
  await chmod(shared, 0o755);
  await expect(acquireNativeServiceCustody(shared)).rejects.toThrow(/private/);
  const parent = await directory();
  await symlink(path, join(parent, "alias"));
  await expect(acquireNativeServiceCustody(join(parent, "alias"))).rejects.toThrow();
});
