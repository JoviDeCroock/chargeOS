import {
  mkdtemp,
  rm,
  utimes,
  link,
  unlink,
  rename,
  readFile,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { mailHeartbeat, mailWorkerHealthy } from "../../service/node/mail-health.ts";

let directory;
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it("requires a fresh private single-link marker for a live process and removes only its own marker", async () => {
  directory = await mkdtemp(join(tmpdir(), "chargeos-mail-health-"));
  const path = join(directory, "health"),
    beat = mailHeartbeat(path);
  expect(mailWorkerHealthy(path)).toBe(false);
  try {
    await beat.pulse();
    expect(mailWorkerHealthy(path)).toBe(true);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ pid: process.pid });
    const old = new Date(Date.now() - 120000);
    await utimes(path, old, old);
    expect(mailWorkerHealthy(path)).toBe(false);
    await beat.pulse();
    expect(mailWorkerHealthy(path)).toBe(true);
    await link(path, join(directory, "linked"));
    expect(mailWorkerHealthy(path)).toBe(false);
    await unlink(join(directory, "linked"));
    await rename(path, join(directory, "original"));
    await writeFile(path, "replacement", { mode: 0o600 });
    await beat.close();
    expect(await readFile(path, "utf8")).toBe("replacement");
  } finally {
    await beat.close();
  }
});
it("never overwrites a pre-existing marker or accepts a dead process or unrelated payload", async () => {
  directory = await mkdtemp(join(tmpdir(), "chargeos-mail-health-"));
  const path = join(directory, "health");
  await writeFile(path, JSON.stringify({ pid: 2147483647 }), { mode: 0o600 });
  expect(mailWorkerHealthy(path)).toBe(false);
  const beat = mailHeartbeat(path);
  await expect(beat.pulse()).rejects.toThrow();
  await beat.close();
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ pid: 2147483647 });
  await writeFile(path, JSON.stringify({ pid: process.pid, released: true }));
  expect(mailWorkerHealthy(path)).toBe(false);
});
