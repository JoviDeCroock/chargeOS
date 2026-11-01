import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { env } from "./env.mjs";
import { fixture, draft, approve, csv } from "../service/reimbursement-helpers.ts";
import { auth, invite, totp } from "../service/helpers.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import {
  exportCommercialRecovery,
  inspectCommercialRecovery,
  restoreCommercialRecovery,
} from "../../service/node/recovery.ts";
import {
  openCommercialPayload,
  sealCommercialPayload,
} from "../../service/node/recovery-crypto.ts";
import {
  readCommercialPassphrase,
  readPrivateRecoveryFile,
} from "../../service/node/recovery-files.ts";
import { financialJournal, readFinancialData } from "../../service/reimbursement-journal.ts";
import { nativeHosting } from "../../service/configuration.ts";
import { nativeConfiguration } from "../../service/node/configuration.ts";

const passphrase = "synthetic commercial recovery passphrase!";
let directory, bundle, originalSummary, financial, employer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "chargeos-commercial-recovery-test-"));
  bundle = join(directory, "commercial.bundle");
  employer = await fixture();
  const original = await draft(employer);
  expect((await approve(employer, original)).status).toBe(200);
  const correction = await draft(
    employer,
    csv
      .split("\n")
      .filter((row, index) => index === 0 || row.startsWith("S-1,"))
      .join("\n"),
    {
      correctionOf: original.id,
      correctionReason: "source-issue",
    },
  );
  const accepted = await employer.finance.browser.request(
    `${employer.root}/statements/${correction.id}/approve`,
    {
      snapshotSha256: correction.snapshotSha256,
      previousSnapshotSha256: correction.snapshot.correction.previousSnapshotSha256,
      authenticatorCode: await totp(employer.financeTotpUri),
    },
  );
  expect(accepted.status).toBe(200);
  await invite(employer.admin.browser, employer.org, "pending-recovery@example.test");
  await employer.admin.browser.request(`${auth}/request-password-reset`, {
    email: employer.admin.email,
    redirectTo: env.SERVICE_ORIGIN + "/service",
  });
  await env.SERVICE_DB.prepare(
    "UPDATE two_factor SET backup_codes='synthetic-used-backup-code-marker'",
  ).run();
  financial = financialJournal(await readFinancialData(env, employer.org.id, "", true));
  const sourceBeforeExport = await readFile(env.SERVICE_DB.path);
  originalSummary = await exportCommercialRecovery(
    env,
    dirname(env.SERVICE_DB.path),
    bundle,
    passphrase,
  );
  expect(await readFile(env.SERVICE_DB.path)).toEqual(sourceBeforeExport);
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it("restores an HTTPS-origin backup only as fresh local quarantine without public hosting or delivery authority", async () => {
  const publicEnv = {
    ...env,
    SERVICE_MODE: "production",
    SERVICE_ORIGIN: "https://accounts.example.test",
    SERVICE_DELIVERY: "smtp",
    SERVICE_SIGNUP_DOMAINS: "example.test",
    [nativeHosting]: true,
  };
  const publicBundle = join(directory, "public.bundle");
  const summary = await exportCommercialRecovery(
    publicEnv,
    dirname(env.SERVICE_DB.path),
    publicBundle,
    passphrase,
  );
  const target = join(directory, "public-restored");
  await restoreCommercialRecovery(publicBundle, target, passphrase);
  const settings = nativeConfiguration({ SERVICE_NATIVE_CONFIG: join(target, "service.vars") });
  expect(settings.configuration.SERVICE_MODE).toBe("local");
  expect(settings.configuration.SERVICE_ORIGIN).toBe("http://127.0.0.1:5173");
  expect(settings.configuration.SERVICE_DELIVERY).toBe("local");
  expect(settings.configuration.SERVICE_AUTH_SECRET).not.toBe(publicEnv.SERVICE_AUTH_SECRET);
  expect(settings.configuration[nativeHosting]).toBeUndefined();
  expect(
    () =>
      new NativeCommercialDatabase(join(target, "data"), {
        recoverySecret: settings.configuration.SERVICE_AUTH_SECRET,
      }),
  ).toThrow(/quarantined/);
  const restored = new NativeCommercialDatabase(join(target, "data"), { recoveryInspection: true });
  try {
    expect(
      JSON.parse(
        await restored
          .prepare("SELECT provenance_json FROM _chargeos_native_recovery")
          .first("provenance_json"),
      ),
    ).toMatchObject({
      sourceOrigin: publicEnv.SERVICE_ORIGIN,
      snapshotSha256: summary.snapshotSha256,
    });
    for (const table of [
      "session",
      "verification",
      "account",
      "two_factor",
      "local_outbox",
      "rate_limit",
    ])
      expect(await restored.prepare(`SELECT count(*) AS n FROM ${table}`).first("n")).toBe(0);
    expect(
      financialJournal(
        await readFinancialData({ SERVICE_DB: restored }, employer.org.id, "", true),
      ),
    ).toEqual(financial);
  } finally {
    restored.close();
  }
});

it("authenticates a consistent snapshot and restores exact financial history with all stale credentials removed and durable quarantine", async () => {
  const before = await readFile(env.SERVICE_DB.path);
  const serialized = await readFile(bundle, "utf8");
  expect(serialized).not.toContain(env.SERVICE_AUTH_SECRET);
  expect(serialized).not.toContain(employer.admin.email);
  expect((await lstat(bundle)).mode & 0o777).toBe(0o600);
  expect(await inspectCommercialRecovery(bundle, passphrase)).toEqual(originalSummary);
  expect(originalSummary).toMatchObject({
    accounts: 3,
    organizations: 1,
    statements: 2,
    adjustments: 1,
    financialState: "snapshot-only-unreconciled",
  });
  const target = join(directory, "restored");
  const restored = await restoreCommercialRecovery(bundle, target, passphrase);
  expect(restored).toMatchObject({ ...originalSummary, status: "quarantined" });
  expect(await readFile(env.SERVICE_DB.path)).toEqual(before);
  expect(() => new NativeCommercialDatabase(join(target, "data"))).toThrow(/quarantined/);
  const database = new NativeCommercialDatabase(join(target, "data"), { recoveryInspection: true });
  try {
    for (const table of [
      "session",
      "verification",
      "local_outbox",
      "account",
      "two_factor",
      "rate_limit",
    ])
      expect(await database.prepare(`SELECT count(*) AS total FROM ${table}`).first("total")).toBe(
        0,
      );
    expect(
      await database
        .prepare(
          "SELECT count(*) AS total FROM user WHERE email_verified!=0 OR two_factor_enabled!=0",
        )
        .first("total"),
    ).toBe(0);
    expect(
      await database
        .prepare("SELECT count(*) AS total FROM invitation WHERE status='pending'")
        .first("total"),
    ).toBe(0);
    expect(
      financialJournal(
        await readFinancialData({ SERVICE_DB: database }, employer.org.id, "", true),
      ),
    ).toEqual(financial);
    const provenance = JSON.parse(
      await database
        .prepare("SELECT provenance_json FROM _chargeos_native_recovery")
        .first("provenance_json"),
    );
    expect(provenance).toMatchObject({
      status: "quarantined",
      snapshotSha256: originalSummary.snapshotSha256,
      sourceBundleSha256: createHash("sha256").update(serialized).digest("hex"),
      financialSha256: originalSummary.financialSha256,
    });
    expect(await readFile(join(target, "service.vars"), "utf8")).not.toContain(
      env.SERVICE_AUTH_SECRET,
    );
    expect(
      (await readFile(database.path)).includes(Buffer.from("synthetic-used-backup-code-marker")),
    ).toBe(false);
  } finally {
    database.close();
  }
  const moved = join(directory, "moved");
  await mkdir(moved, { mode: 0o700 });
  await writeFile(
    join(moved, "commercial.sqlite"),
    await readFile(join(target, "data/commercial.sqlite")),
    { mode: 0o600 },
  );
  expect(() => new NativeCommercialDatabase(moved)).toThrow(/quarantined/);
  await expect(
    exportCommercialRecovery(env, moved, join(directory, "forbidden.bundle"), passphrase),
  ).rejects.toThrow(/quarantined/);
  // Deleting the quarantine row cannot turn its database into a runnable one.
  const inspect = new NativeCommercialDatabase(moved, { recoveryInspection: true });
  await inspect.prepare("DELETE FROM _chargeos_native_recovery").run();
  inspect.close();
  expect(() => new NativeCommercialDatabase(moved)).toThrow(/quarantined/);
});

it("rejects wrong keys, authenticated header/ciphertext changes, foreign formats and hostile KDF parameters before restore", async () => {
  await expect(
    inspectCommercialRecovery(bundle, "different synthetic recovery passphrase"),
  ).rejects.toThrow(/authentication/);
  const original = JSON.parse(await readFile(bundle, "utf8"));
  const mutations = [
    (value) => {
      value.createdAt = "2026-01-01T00:00:00.000Z";
    },
    (value) => {
      value.format = "chargeos-owner-continuity";
    },
    (value) => {
      value.schemaVersion = 2;
    },
    ...["salt", "iv", "authTag", "ciphertext"].map((field) => (value) => {
      const bytes = Buffer.from(value.encryption[field], "base64");
      bytes[0] ^= 1;
      value.encryption[field] = bytes.toString("base64");
    }),
    (value) => {
      value.encryption.n = 2 ** 30;
    },
    (value) => {
      value.encryption.ciphertext += "====";
    },
    (value) => {
      value.extra = "ignored?";
    },
  ];
  for (const [index, change] of mutations.entries()) {
    const value = structuredClone(original);
    change(value);
    const path = join(directory, `invalid-${index}.bundle`),
      target = join(directory, `invalid-${index}`);
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await expect(restoreCommercialRecovery(path, target, passphrase)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  }
});

it("refuses changed schema, migration history, snapshot hashes and adjustment integrity even inside an authenticated bundle", async () => {
  const { value, createdAt } = await openCommercialPayload(
    await readFile(bundle, "utf8"),
    passphrase,
  );
  const edits = [
    "CREATE TABLE unexpected (id TEXT)",
    "CREATE VIEW unexpected AS SELECT * FROM user",
    "CREATE TRIGGER unexpected AFTER INSERT ON user BEGIN SELECT 1; END",
    "CREATE TABLE sqliteXextra (id TEXT)",
    "CREATE TRIGGER sqliteXextra AFTER UPDATE ON invitation BEGIN INSERT INTO local_outbox VALUES('stale','reset-password','attacker@example.test','http://127.0.0.1:5173/service',0,9999999999999); END",
    "UPDATE _chargeos_native_migration SET sha256='bad' WHERE position=0",
    "UPDATE reimbursement_statement SET snapshot_sha256='bad'",
    "UPDATE reimbursement_adjustment SET difference_cents=99",
  ];
  for (const [index, sql] of edits.entries()) {
    const data = join(directory, `changed-${index}`);
    await mkdir(data, { mode: 0o700 });
    await writeFile(join(data, "commercial.sqlite"), Buffer.from(value.databaseBase64, "base64"), {
      mode: 0o600,
    });
    const database = new NativeCommercialDatabase(data);
    await database.prepare(sql).run();
    database.close();
    const bytes = await readFile(join(data, "commercial.sqlite"));
    const path = join(directory, `changed-${index}.bundle`),
      target = join(directory, `changed-output-${index}`);
    await writeFile(
      path,
      await sealCommercialPayload(
        {
          ...value,
          databaseSha256: createHash("sha256").update(bytes).digest("hex"),
          databaseBase64: bytes.toString("base64"),
        },
        createdAt,
        passphrase,
      ),
      { mode: 0o600 },
    );
    await expect(restoreCommercialRecovery(path, target, passphrase)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  }
  const wrongDigest = join(directory, "wrong-digest.bundle");
  await writeFile(
    wrongDigest,
    await sealCommercialPayload(
      { ...value, databaseSha256: "0".repeat(64) },
      createdAt,
      passphrase,
    ),
    { mode: 0o600 },
  );
  await expect(inspectCommercialRecovery(wrongDigest, passphrase)).rejects.toThrow(/digest/);
}, 15000);

it("never overwrites occupied outputs, follows links or initializes a missing source", async () => {
  const occupied = join(directory, "occupied");
  await mkdir(occupied, { mode: 0o700 });
  await writeFile(join(occupied, "keep"), "untouched");
  await expect(restoreCommercialRecovery(bundle, occupied, passphrase)).rejects.toThrow();
  expect(await readFile(join(occupied, "keep"), "utf8")).toBe("untouched");
  const linked = join(directory, "linked-target");
  await symlink(occupied, linked);
  await expect(restoreCommercialRecovery(bundle, linked, passphrase)).rejects.toThrow();
  await expect(
    exportCommercialRecovery(env, dirname(env.SERVICE_DB.path), bundle, passphrase),
  ).rejects.toThrow();
  expect(await inspectCommercialRecovery(bundle, passphrase)).toEqual(originalSummary);
  const missing = join(directory, "missing-source");
  await expect(
    exportCommercialRecovery(env, missing, join(directory, "missing.bundle"), passphrase),
  ).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
});

it("bounds private passphrases and bundle input and rejects symlinks, hardlinks and shared permissions", async () => {
  const path = join(directory, "passphrase");
  await writeFile(path, passphrase + "\n", { mode: 0o600 });
  expect(await readCommercialPassphrase(path)).toBe(passphrase);
  const hard = join(directory, "passphrase-hardlink");
  await link(path, hard);
  await expect(readCommercialPassphrase(path)).rejects.toThrow(/without links/);
  await rm(hard);
  const symbolic = join(directory, "passphrase-symlink");
  await symlink(path, symbolic);
  await expect(readCommercialPassphrase(symbolic)).rejects.toThrow(/regular file/);
  await chmod(path, 0o644);
  await expect(readCommercialPassphrase(path)).rejects.toThrow(/owner-private/);
  await chmod(path, 0o600);
  await writeFile(path, "x".repeat(4097));
  await expect(readCommercialPassphrase(path)).rejects.toThrow(/bounded/);
  await writeFile(path, passphrase + "\nsecond line");
  await expect(readCommercialPassphrase(path)).rejects.toThrow(/single recovery passphrase/);
  await expect(readPrivateRecoveryFile(bundle, 32)).rejects.toThrow(/bounded/);
});

it("removes only its new incomplete package after an interrupted restore write", async () => {
  // Use the real descriptor prototype to inject one destination write failure.
  const handle = await (await import("node:fs/promises")).open(bundle, "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const originalWrite = prototype.writeFile,
    target = join(directory, "interrupted");
  const spy = vi.spyOn(prototype, "writeFile").mockImplementation(async function (
    bytes,
    ...options
  ) {
    if (typeof bytes === "string" && bytes.includes("SERVICE_AUTH_SECRET="))
      throw new Error("synthetic interrupted config write");
    return originalWrite.call(this, bytes, ...options);
  });
  try {
    await expect(restoreCommercialRecovery(bundle, target, passphrase)).rejects.toThrow(
      /interrupted/,
    );
  } finally {
    spy.mockRestore();
  }
  expect(existsSync(target)).toBe(false);
  expect(await inspectCommercialRecovery(bundle, passphrase)).toEqual(originalSummary);
});

it("preserves a replacement directory when failure cleanup no longer owns the target inode", async () => {
  const handle = await (await import("node:fs/promises")).open(bundle, "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const originalWrite = prototype.writeFile,
    target = join(directory, "replaced-at-failure");
  const spy = vi.spyOn(prototype, "writeFile").mockImplementation(async function (
    bytes,
    ...options
  ) {
    if (typeof bytes === "string" && bytes.includes("SERVICE_AUTH_SECRET=")) {
      await rename(target, target + "-moved");
      await mkdir(target, { mode: 0o700 });
      await writeFile(join(target, "keep"), "replacement belongs to someone else");
      throw new Error("synthetic replacement during write");
    }
    return originalWrite.call(this, bytes, ...options);
  });
  try {
    await expect(restoreCommercialRecovery(bundle, target, passphrase)).rejects.toThrow(
      /replacement/,
    );
  } finally {
    spy.mockRestore();
  }
  expect(await readFile(join(target, "keep"), "utf8")).toBe("replacement belongs to someone else");
});

it("rejects a matching financial snapshot whose approved journal balance is invalid", async () => {
  const { value, createdAt } = await openCommercialPayload(
    await readFile(bundle, "utf8"),
    passphrase,
  );
  const data = join(directory, "bad-balance");
  await mkdir(data, { mode: 0o700 });
  await writeFile(join(data, "commercial.sqlite"), Buffer.from(value.databaseBase64, "base64"), {
    mode: 0o600,
  });
  const database = new NativeCommercialDatabase(data);
  try {
    await database.prepare("DELETE FROM reimbursement_adjustment").run();
    const rows = await database
      .prepare("SELECT id,snapshot_json FROM reimbursement_statement")
      .all();
    for (const row of rows.results) {
      const snapshot = JSON.parse(row.snapshot_json);
      if (snapshot.correction)
        await database
          .prepare("UPDATE reimbursement_statement SET status='rejected' WHERE id=?")
          .bind(row.id)
          .run();
      else {
        snapshot.expectedAmountCents = -133;
        const serialized = JSON.stringify(snapshot),
          hash = createHash("sha256").update(serialized).digest("hex");
        await database
          .prepare(
            "UPDATE reimbursement_statement SET amount_cents=-133,snapshot_json=?,snapshot_sha256=? WHERE id=?",
          )
          .bind(serialized, hash, row.id)
          .run();
      }
    }
    const financialData = await readFinancialData(
      { SERVICE_DB: database },
      employer.org.id,
      "",
      true,
    );
    expect(() => financialJournal(financialData)).toThrow(/integrity/);
  } finally {
    database.close();
  }
  const bytes = await readFile(join(data, "commercial.sqlite")),
    path = join(directory, "bad-balance.bundle");
  await writeFile(
    path,
    await sealCommercialPayload(
      {
        ...value,
        databaseBase64: bytes.toString("base64"),
        databaseSha256: createHash("sha256").update(bytes).digest("hex"),
      },
      createdAt,
      passphrase,
    ),
    { mode: 0o600 },
  );
  await expect(
    restoreCommercialRecovery(path, join(directory, "bad-balance-output"), passphrase),
  ).rejects.toThrow(/integrity/);
  expect(existsSync(join(directory, "bad-balance-output"))).toBe(false);
});

it("keeps a finished online snapshot transactionally consistent with a concurrent connection writer", async () => {
  const source = env.SERVICE_DB;
  const organization = await source
    .prepare("SELECT name,created_by FROM organization WHERE id=?")
    .bind(employer.org.id)
    .first();
  const actorName = await source
    .prepare("SELECT name FROM user WHERE id=?")
    .bind(organization.created_by)
    .first("name");
  const pair = (name) =>
    source.batch([
      source.prepare("UPDATE organization SET name=? WHERE id=?").bind(name, employer.org.id),
      source.prepare("UPDATE user SET name=? WHERE id=?").bind(name, organization.created_by),
    ]);
  await pair("snapshot-before");
  const originalSnapshot = NativeCommercialDatabase.prototype.snapshotTo;
  let overlapped = false;
  const spy = vi
    .spyOn(NativeCommercialDatabase.prototype, "snapshotTo")
    .mockImplementation(async function (target) {
      const pending = originalSnapshot.call(this, target);
      if (this.path === source.path) {
        overlapped = true;
        await pair("snapshot-after");
      }
      return pending;
    });
  try {
    const output = join(directory, "online.bundle");
    await exportCommercialRecovery(env, dirname(source.path), output, passphrase);
    expect(overlapped).toBe(true);
    expect((await inspectCommercialRecovery(output, passphrase)).financialSha256).toBe(
      originalSummary.financialSha256,
    );
    const { value } = await openCommercialPayload(await readFile(output, "utf8"), passphrase);
    const copy = join(directory, "online-copy");
    await mkdir(copy, { mode: 0o700 });
    await writeFile(join(copy, "commercial.sqlite"), Buffer.from(value.databaseBase64, "base64"), {
      mode: 0o600,
    });
    const snapshot = new NativeCommercialDatabase(copy);
    try {
      const result = await snapshot
        .prepare(
          "SELECT o.name AS organization_name,u.name AS actor_name FROM organization o JOIN user u ON u.id=o.created_by WHERE o.id=?",
        )
        .bind(employer.org.id)
        .first();
      expect(["snapshot-before", "snapshot-after"]).toContain(result.organization_name);
      expect(result.organization_name).toBe(result.actor_name);
    } finally {
      snapshot.close();
    }
  } finally {
    spy.mockRestore();
    await source.batch([
      source
        .prepare("UPDATE organization SET name=? WHERE id=?")
        .bind(organization.name, employer.org.id),
      source.prepare("UPDATE user SET name=? WHERE id=?").bind(actorName, organization.created_by),
    ]);
  }
});
