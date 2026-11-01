import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeConfiguration } from "../../service/node/configuration.ts";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("requires owner-private bounded local configuration and does not accept public deployment settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-native-config-"));
  directories.push(directory);
  const path = join(directory, "service.vars");
  const local =
    "SERVICE_MODE=local\nSERVICE_ORIGIN=http://127.0.0.1:5173\nSERVICE_AUTH_SECRET=synthetic-native-config-secret-at-least-32-characters\n";
  await writeFile(path, local, { mode: 0o600 });
  expect(nativeConfiguration({ SERVICE_NATIVE_CONFIG: path }).port).toBe(9091);
  expect(() =>
    nativeConfiguration({ SERVICE_NATIVE_CONFIG: path, SERVICE_NATIVE_PORT: "-1" }),
  ).toThrow(/port/);
  await chmod(path, 0o644);
  expect(() => nativeConfiguration({ SERVICE_NATIVE_CONFIG: path })).toThrow(/owner-private/);
  await chmod(path, 0o600);
  const link = join(directory, "link");
  await symlink(path, link);
  expect(() => nativeConfiguration({ SERVICE_NATIVE_CONFIG: link })).toThrow();
  await writeFile(path, local.replace("http://127.0.0.1:5173", "https://charge.example.be"));
  expect(() => nativeConfiguration({ SERVICE_NATIVE_CONFIG: path })).toThrow(/explicit local/);
  await writeFile(path, "x".repeat(8193));
  expect(() => nativeConfiguration({ SERVICE_NATIVE_CONFIG: path })).toThrow(/bounded/);
});
