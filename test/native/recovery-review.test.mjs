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
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { env } from "./env.mjs";
import { fixture, draft, approve } from "../service/reimbursement-helpers.ts";
import { createOrganization } from "../service/helpers.ts";
import {
  exportCommercialRecovery,
  inspectNativeCommercialDatabase,
  restoreCommercialRecovery,
} from "../../service/node/recovery.ts";
import {
  checkpointNativeCommercial,
  createNativeRecoveryReviewTemplate,
  validateNativeRecoveryReview,
  withNativeRecoveryCustody,
  RECOVERY_REVIEW_CONFIRMATION,
} from "../../service/node/recovery-review.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";

let directory, data, manifest, f;
const passphrase = "synthetic review backup passphrase!";
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "chargeos-recovery-review-"));
  f = await fixture();
  expect((await approve(f, await draft(f))).status).toBe(200);
  const second = await f.admin.browser.request(`${f.root}/assignments`, {
    ...f.assignmentBody,
    driverAlias: "second-driver",
    stationAlias: "second-home",
  });
  expect(second.status).toBe(201);
  const assignment = await second.json();
  expect(
    (
      await f.admin.browser.request(`${f.root}/assignments/${assignment.id}/end`, {
        effectiveUntil: "2026-09-01T00:00:00Z",
      })
    ).status,
  ).toBe(200);
  await createOrganization(f.admin.browser, "Second independent recovery employer");
  const backup = join(directory, "source.bundle"),
    target = join(directory, "restored"),
    checkpoint = join(directory, "current-financial-checkpoint.json");
  await exportCommercialRecovery(env, dirname(env.SERVICE_DB.path), backup, passphrase);
  const source = await readFile(env.SERVICE_DB.path);
  await checkpointNativeCommercial(env, dirname(env.SERVICE_DB.path), checkpoint);
  expect(await readFile(env.SERVICE_DB.path)).toEqual(source);
  await restoreCommercialRecovery(backup, target, passphrase);
  data = join(target, "data");
  const template = join(directory, "template.json");
  expect(await createNativeRecoveryReviewTemplate(data, template)).toMatchObject({
    status: "unreviewed-template",
    organizations: 2,
    reopeningAllowed: false,
  });
  manifest = JSON.parse(await readFile(template, "utf8"));
  const proof = join(directory, "current-private-evidence.txt");
  await writeFile(
    proof,
    "Synthetic operator-held HR, identity, unpaid register and stopped-source evidence. These are test assertions, not real-world proof.",
    { mode: 0o600 },
  );
  manifest.confirmation = RECOVERY_REVIEW_CONFIRMATION;
  manifest.sourceRetirementEvidenceFile = proof;
  manifest.financialCheckpointFile = checkpoint;
  manifest.reviewedThrough = new Date().toISOString();
  for (const org of manifest.organizations) {
    org.financialEvidenceFile = proof;
    org.rosterEvidenceFile = proof;
    for (const member of org.members) {
      member.decision = member.email === f.driver.email ? "remove" : "keep";
      member.identityEvidenceFile = member.decision === "keep" ? proof : "";
    }
    const removed = new Set(
      org.members.filter((member) => member.decision === "remove").map((member) => member.userId),
    );
    org.eligibilityEnds = org.reference.assignments
      .filter((assignment) => removed.has(assignment.employeeId))
      .map((assignment) => ({
        assignmentId: assignment.id,
        expectedExistingUntil: assignment.existingEnd,
        effectiveUntil: assignment.existingEnd ?? "2026-10-01T00:00:00.000Z",
      }));
  }
}, 60000);
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
let serial = 0;
async function validate(value = manifest, source = data) {
  const input = join(directory, `review-${++serial}.json`),
    output = join(directory, `validated-${serial}.json`);
  await writeFile(input, JSON.stringify(value), { mode: 0o600 });
  const result = await validateNativeRecoveryReview(source, input, output);
  return { result, output, input, report: JSON.parse(await readFile(output, "utf8")) };
}
async function clone() {
  const target = join(directory, `copy-${++serial}`);
  await mkdir(target, { mode: 0o700 });
  await writeFile(
    join(target, "commercial.sqlite"),
    await readFile(join(data, "commercial.sqlite")),
    { mode: 0o600 },
  );
  return target;
}

it("binds every employer, current identity, explicit removal and immutable eligibility end without changing quarantine or source records", async () => {
  const before = await readFile(join(data, "commercial.sqlite"));
  const { result, report, output } = await validate();
  expect(result).toMatchObject({
    status: "reviewed-not-enrolled",
    selectedMemberships: 3,
    removedMemberships: 1,
    reopeningAllowed: false,
  });
  expect(report).toMatchObject({
    restoreId: manifest.restoreId,
    provenanceSha256: manifest.provenanceSha256,
    businessSha256: manifest.businessSha256,
    reopeningAllowed: false,
  });
  expect(report.organizations).toHaveLength(2);
  expect(JSON.stringify(report)).not.toContain(directory);
  expect(JSON.stringify(report)).not.toContain(env.SERVICE_AUTH_SECRET);
  expect((await lstat(output)).mode & 0o777).toBe(0o600);
  expect(await readFile(join(data, "commercial.sqlite"))).toEqual(before);
  expect(() => new NativeCommercialDatabase(data)).toThrow(/quarantined/);
});

it("rejects unreviewed, incomplete, duplicate, foreign and mismatched identities or recovery provenance", async () => {
  const changes = [
    (value) => {
      value.confirmation = "";
    },
    (value) => {
      value.organizations.pop();
    },
    (value) => {
      value.organizations[1] = value.organizations[0];
    },
    (value) => {
      value.organizations[0].id = "foreign-organization";
    },
    (value) => {
      value.restoreId = "foreign-restore";
    },
    (value) => {
      value.provenanceSha256 = "0".repeat(64);
    },
    (value) => {
      value.organizations.find((org) => org.members.length > 1).members.pop();
    },
    (value) => {
      value.organizations[0].members[0].email = "different@example.test";
    },
    (value) => {
      value.organizations[0].members[0].decision = "unreviewed";
    },
    (value) => {
      value.organizations[0].reference.organizationName = "unreviewed misleading name";
    },
  ];
  for (const change of changes) {
    const value = structuredClone(manifest);
    change(value);
    await expect(validate(value)).rejects.toThrow();
  }
});

it("blocks missing creator succession, unsupported admin grants and missing or conflicting per-assignment ends", async () => {
  const changes = [
    (value) => {
      const org = value.organizations.find((item) => item.eligibilityEnds.length);
      org.eligibilityEnds.pop();
    },
    (value) => {
      const org = value.organizations.find((item) => item.eligibilityEnds.length);
      org.eligibilityEnds[0].assignmentId = "foreign-assignment";
    },
    (value) => {
      const end = value.organizations
        .flatMap((org) => org.eligibilityEnds)
        .find((end) => end.expectedExistingUntil);
      end.effectiveUntil = "2026-08-01T00:00:00.000Z";
    },
    (value) => {
      const org = value.organizations.find((item) => item.members.length > 1);
      org.members.find((member) => member.userId !== org.reference.protectedCreatorId).role =
        "admin";
    },
    (value) => {
      const member = value.organizations[0].members.find(
        (member) => member.userId === value.organizations[0].reference.protectedCreatorId,
      );
      member.decision = "remove";
      member.identityEvidenceFile = "";
    },
  ];
  for (const change of changes) {
    const value = structuredClone(manifest);
    change(value);
    await expect(validate(value)).rejects.toThrow();
  }
});

it("rejects stale financial checkpoints, divergent financial records and absent current fencing evidence", async () => {
  const original = JSON.parse(await readFile(manifest.financialCheckpointFile, "utf8"));
  for (const [index, change] of [
    (value) => {
      value.capturedAt = "2020-01-01T00:00:00.000Z";
    },
    (value) => {
      value.organizations[0].financialSha256 = "f".repeat(64);
    },
    (value) => {
      value.organizations.pop();
    },
    (value) => {
      value.organizations[1] = value.organizations[0];
    },
  ].entries()) {
    const checkpoint = structuredClone(original);
    change(checkpoint);
    const path = join(directory, `wrong-checkpoint-${index}.json`);
    await writeFile(path, JSON.stringify(checkpoint), { mode: 0o600 });
    await expect(validate({ ...manifest, financialCheckpointFile: path })).rejects.toThrow(
      /checkpoint/,
    );
  }
  await expect(validate({ ...manifest, sourceRetirementEvidenceFile: "" })).rejects.toThrow();
  await expect(
    validate({ ...manifest, reviewedThrough: new Date(Date.now() - 86400000 * 2).toISOString() }),
  ).rejects.toThrow(/current time/);
  await expect(
    validate({ ...manifest, reviewedThrough: new Date(Date.now() + 86400000).toISOString() }),
  ).rejects.toThrow(/current time/);
});

it("detects changes to immutable identities, memberships, provenance and finances while excluding narrowly defined authentication flags", async () => {
  for (const sql of [
    "UPDATE user SET email='unreviewed-recipient@example.test' WHERE id=(SELECT user_id FROM membership WHERE role='driver' LIMIT 1)",
    "UPDATE membership SET role='driver' WHERE role='finance'",
    "UPDATE reimbursement_statement SET snapshot_sha256='bad'",
  ]) {
    const target = await clone(),
      database = new NativeCommercialDatabase(target, { recoveryInspection: true });
    await database.prepare(sql).run();
    database.close();
    await expect(validate(manifest, target)).rejects.toThrow();
  }
  const target = await clone(),
    database = new NativeCommercialDatabase(target, { recoveryInspection: true });
  await database
    .prepare("UPDATE user SET email_verified=1,two_factor_enabled=1,updated_at=?")
    .bind(Date.now())
    .run();
  database.close();
  expect((await validate(manifest, target)).result.reopeningAllowed).toBe(false);
  expect(() => new NativeCommercialDatabase(target)).toThrow(/quarantined/);
});

it("refuses shared/linked evidence and occupied output without modifying the caller's files", async () => {
  const path = join(directory, "unsafe-evidence.txt");
  await writeFile(path, "synthetic current evidence", { mode: 0o644 });
  await expect(validate({ ...manifest, sourceRetirementEvidenceFile: path })).rejects.toThrow(
    /owner-private/,
  );
  await chmod(path, 0o600);
  const linked = join(directory, "linked-evidence");
  await symlink(path, linked);
  await expect(validate({ ...manifest, sourceRetirementEvidenceFile: linked })).rejects.toThrow(
    /regular file/,
  );
  const { input, output } = await validate();
  const saved = await readFile(output);
  await expect(validateNativeRecoveryReview(data, input, output)).rejects.toThrow();
  expect(await readFile(output)).toEqual(saved);
});

it("enforces recovery lifecycle custody, retains stale locks and preserves replacement directories during cleanup", async () => {
  const lock = join(data, ".recovery-lifecycle");
  await withNativeRecoveryCustody(data, async () => {
    expect(existsSync(lock)).toBe(true);
    await expect(
      createNativeRecoveryReviewTemplate(data, join(directory, "locked-template.json")),
    ).rejects.toThrow();
    expect(existsSync(lock)).toBe(true);
  });
  expect(existsSync(lock)).toBe(false);
  await mkdir(lock, { mode: 0o700 });
  await expect(
    createNativeRecoveryReviewTemplate(data, join(directory, "stale-lock-template.json")),
  ).rejects.toThrow();
  expect(existsSync(lock)).toBe(true);
  await rm(lock, { recursive: true });
  await expect(
    withNativeRecoveryCustody(data, async () => {
      await rename(lock, lock + "-moved");
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, "keep"), "new owner");
      throw new Error("synthetic replacement");
    }),
  ).rejects.toThrow(/replacement/);
  expect(await readFile(join(lock, "keep"), "utf8")).toBe("new owner");
  await rm(lock, { recursive: true });
  await rm(lock + "-moved", { recursive: true });
});

it("rejects an actual different restore epoch and never publishes review artifacts into its own temporary custody directory", async () => {
  const replacement = join(directory, "different-restore");
  await restoreCommercialRecovery(join(directory, "source.bundle"), replacement, passphrase);
  await expect(validate(manifest, join(replacement, "data"))).rejects.toThrow(/does not match/);
  const lock = join(data, ".recovery-lifecycle"),
    alias = join(directory, "custody-alias");
  await symlink(lock, alias);
  await expect(
    createNativeRecoveryReviewTemplate(data, join(lock, "lost-template.json")),
  ).rejects.toThrow(/outside/);
  await expect(
    createNativeRecoveryReviewTemplate(data, join(alias, "lost-template.json")),
  ).rejects.toThrow(/outside/);
  const { input } = await validate();
  await expect(
    validateNativeRecoveryReview(data, input, join(lock, "lost-report.json")),
  ).rejects.toThrow(/outside/);
  await expect(
    validateNativeRecoveryReview(data, input, join(alias, "lost-report.json")),
  ).rejects.toThrow(/outside/);
  expect(existsSync(lock)).toBe(false);
});

it("bounds the actual finished database before schema or financial inspection, including a source that grew during snapshotting", async () => {
  const target = join(directory, "oversized-finished-copy");
  const database = new NativeCommercialDatabase(target);
  try {
    await database.prepare("CREATE TABLE payload (data BLOB)").run();
    await database
      .prepare("INSERT INTO payload VALUES(zeroblob(?))")
      .bind(64 * 1024 * 1024)
      .run();
    expect((await lstat(database.path)).size).toBeGreaterThan(64 * 1024 * 1024);
    await expect(inspectNativeCommercialDatabase(database)).rejects.toThrow(/size boundary/);
  } finally {
    database.close();
  }
});
