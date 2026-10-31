import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const model = JSON.parse(
  await readFile(new URL("../compose.coolify.json", import.meta.url), "utf8"),
);
const source = model.services.credentials.command[2];
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temp() {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-seed-test-"));
  directories.push(directory);
  return directory;
}
function seed(directory, value = "synthetic-owner-secret-DO-NOT-LOG") {
  return execFileSync(
    process.execPath,
    ["-e", source.replace("'/data'", JSON.stringify(directory))],
    {
      env: { CHARGEOS_SEED_owner_api_token: value },
      timeout: 1500,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
it("seeds 0444 credentials and verifies an identical retry without changing the inode", async () => {
  const directory = await temp();
  const path = join(directory, "owner_api_token");
  seed(directory);
  const before = await lstat(path);
  expect(before.mode & 0o777).toBe(0o444);
  expect(seed(directory)).not.toContain("DO-NOT-LOG");
  expect((await lstat(path)).ino).toBe(before.ino);
  expect(await readFile(path, "utf8")).toBe("synthetic-owner-secret-DO-NOT-LOG");
});
it("refuses new values, changed permissions and interrupted partial files without replacement", async () => {
  const directory = await temp();
  const path = join(directory, "owner_api_token");
  seed(directory);
  expect(() => seed(directory, "different-owner-secret-DO-NOT-LOG")).toThrow();
  expect(await readFile(path, "utf8")).toBe("synthetic-owner-secret-DO-NOT-LOG");
  await chmod(path, 0o600);
  expect(() => seed(directory)).toThrow();
  await writeFile(path, "partial");
  await chmod(path, 0o444);
  try {
    seed(directory);
    throw new Error("Expected failure");
  } catch (error) {
    expect(`${error.stdout}${error.stderr}`).not.toContain("synthetic-owner-secret-DO-NOT-LOG");
  }
  expect(await readFile(path, "utf8")).toBe("partial");
});
it("does not follow symlinks or block on non-regular credential paths", async () => {
  const directory = await temp();
  const elsewhere = await temp();
  const outside = join(elsewhere, "outside");
  await writeFile(outside, "keep-me", { mode: 0o444 });
  const path = join(directory, "owner_api_token");
  await symlink(outside, path);
  expect(() => seed(directory)).toThrow();
  expect(await readFile(outside, "utf8")).toBe("keep-me");
  await rm(path);
  execFileSync("mkfifo", [path]);
  await chmod(path, 0o444);
  try {
    seed(directory);
    throw new Error("Expected failure");
  } catch (error) {
    expect(error.code).not.toBe("ETIMEDOUT");
  }
});
