import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  lstat,
  rm,
  symlink,
  link,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { companyDeploymentInput } from "../scripts/company-deployment.mjs";
import {
  prepareCompanyRecoveryDeployment,
  requireExternalRecoveryPath,
} from "../scripts/company-recovery.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const sha = (b) => createHash("sha256").update(b).digest("hex");
const input = () =>
  companyDeploymentInput({
    name: "recovery-transport",
    target: "docker",
    companyDomain: "accounts.example.be",
    signupDomains: "example.be",
    email: "operator@example.test",
    smtpHost: "smtp.example.test",
    smtpPort: "587",
    smtpSecurity: "starttls",
    smtpUsername: "synthetic-user",
    smtpPassword: "synthetic-private-mail-password",
    smtpSender: "accounts@example.test",
    deploy: false,
  });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chargeos-recovery-transport-"));
  roots.push(root);
  const source = join(root, "capsule");
  await mkdir(source, { mode: 0o700 });
  await mkdir(join(source, "data"), { mode: 0o700 });
  // Transport-only envelope. Authentic SQL/HMAC/finance authority is exercised
  // by native tests and the compiled Docker recovery drill, never inferred here.
  const database = Buffer.concat([
      Buffer.from("SQLite format 3\0", "binary"),
      Buffer.from([255, 0, 128, 1]),
    ]),
    key = "a".repeat(96),
    manifest = {
      format: "chargeos-native-public-install",
      schemaVersion: 1,
      handoffId: randomUUID(),
      releaseId: randomUUID(),
      origin: "https://accounts.example.be",
      databaseSha256: sha(database),
      handoffSha256: sha("transport fixture"),
    };
  await writeFile(join(source, "data/commercial.sqlite"), database, { mode: 0o600 });
  await writeFile(join(source, "auth.key"), key, { mode: 0o600 });
  await writeFile(join(source, "install.json"), JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(
    join(source, "READY"),
    JSON.stringify({
      format: "chargeos-public-handoff-ready",
      schemaVersion: 1,
      handoffId: manifest.handoffId,
      installationSha256: sha(JSON.stringify(manifest)),
    }),
    { mode: 0o600 },
  );
  return { root, source, database, key, manifest };
}
it("transports binary capsule files without changing its key and gates accounts behind the isolated installer", async () => {
  const f = await fixture(),
    settings = input(),
    prepared = await prepareCompanyRecoveryDeployment(settings, f.source, f.root),
    s = prepared.model.services;
  expect(await readFile(join(prepared.directory, "secrets/company_database"))).toEqual(f.database);
  expect(await readFile(join(prepared.directory, "secrets/company_auth"), "utf8")).toBe(f.key);
  expect(s["recovery-install"]).toMatchObject({
    network_mode: "none",
    user: "1000:1000",
    read_only: true,
    tmpfs: ["/tmp:size=256m,mode=1777"],
  });
  expect(s["recovery-install"].secrets).toEqual([
    "company_auth",
    "company_database",
    "company_install",
  ]);
  expect(s.accounts.depends_on["recovery-install"]).toEqual({
    condition: "service_completed_successfully",
  });
  expect(s.accounts.secrets).toEqual(["company_auth"]);
  expect(s.mailer.secrets).not.toContain("company_database");
  expect(JSON.stringify(prepared.model)).not.toContain(f.key);
  expect(JSON.stringify(prepared.model)).not.toContain(settings.smtp.password);
  expect(prepared.receipt.recoveryHandoffId).toBe(f.manifest.handoffId);
  expect(await readFile(join(prepared.directory, "START-HERE.txt"), "utf8")).toContain("--start");
  for (const name of ["company_database", "company_install", "company_auth"])
    expect((await lstat(join(prepared.directory, "secrets", name))).mode & 0o777).toBe(0o444);
});
it("rejects incomplete, changed or foreign-origin envelopes before reserving deployment files", async () => {
  for (const kind of ["ready", "database", "origin", "extra"]) {
    const f = await fixture();
    if (kind === "ready") await rm(join(f.source, "READY"));
    if (kind === "database") await writeFile(join(f.source, "data/commercial.sqlite"), "changed");
    if (kind === "origin") f.manifest.origin = "https://other.example.be";
    if (kind === "extra") f.manifest.extra = true;
    if (["origin", "extra"].includes(kind))
      await writeFile(join(f.source, "install.json"), JSON.stringify(f.manifest));
    await expect(prepareCompanyRecoveryDeployment(input(), f.source, f.root)).rejects.toThrow();
    await expect(lstat(join(f.root, input().name))).rejects.toThrow();
  }
});
it("refuses shared and linked credential files or capsule directories", async () => {
  for (const kind of ["shared", "symlink", "hardlink", "directory"]) {
    const f = await fixture(),
      key = join(f.source, "auth.key");
    if (kind === "shared") await chmod(key, 0o644);
    if (kind === "directory") await chmod(f.source, 0o755);
    if (kind === "symlink" || kind === "hardlink") {
      await rm(key);
      await writeFile(join(f.root, "other-key"), f.key, { mode: 0o600 });
      if (kind === "symlink") await symlink(join(f.root, "other-key"), key);
      else await link(join(f.root, "other-key"), key);
    }
    await expect(prepareCompanyRecoveryDeployment(input(), f.source, f.root)).rejects.toThrow();
  }
});
it("never sends a recovery capsule into the cloud adapter", async () => {
  const f = await fixture();
  await expect(
    prepareCompanyRecoveryDeployment({ ...input(), target: "coolify" }, f.source, f.root),
  ).rejects.toThrow(/local Docker/);
});

it("keeps capsules and settings outside build contexts even through aliases before creating deployment files", async () => {
  const f = await fixture(),
    checkout = join(f.root, "checkout");
  await mkdir(checkout, { mode: 0o700 });
  for (const name of ["Dockerfile.company", "compose.company.json", "package.json"])
    await writeFile(join(checkout, name), "synthetic build root");
  const capsule = join(checkout, "capsule"),
    settings = join(checkout, "settings.json"),
    alias = join(f.root, "alias");
  await rename(f.source, capsule);
  await writeFile(settings, "{}", { mode: 0o600 });
  await symlink(checkout, alias);
  for (const path of [capsule, join(alias, "capsule")])
    await expect(prepareCompanyRecoveryDeployment(input(), path, f.root)).rejects.toThrow(
      /outside.*build context/,
    );
  for (const path of [settings, join(alias, "settings.json")])
    await expect(requireExternalRecoveryPath(path)).rejects.toThrow(/outside.*build context/);
  await expect(requireExternalRecoveryPath(capsule, { preparedDeployment: true })).rejects.toThrow(
    /outside.*build context/,
  );
  try {
    execFileSync(process.execPath, ["scripts/resume-company.mjs", "--start", capsule], {
      encoding: "utf8",
      stdio: "pipe",
    });
    throw new Error("Unsafe start was accepted");
  } catch (error) {
    expect(error.stderr).toContain("outside the software checkout/build context");
  }
  await expect(lstat(join(f.root, input().name))).rejects.toThrow();
});

it("permits only the generator's exact ignored in-checkout output for prepared deployment starts", async () => {
  const f = await fixture(),
    prepared = await prepareCompanyRecoveryDeployment(input(), f.source);
  roots.push(prepared.directory);
  await expect(
    requireExternalRecoveryPath(prepared.directory, { preparedDeployment: true }),
  ).resolves.toBeUndefined();
  await expect(requireExternalRecoveryPath(prepared.directory)).rejects.toThrow(
    /outside.*build context/,
  );
});
