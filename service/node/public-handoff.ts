import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { localConfiguration, publicServiceOrigin, type ServiceSettings } from "../configuration.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import { inspectNativeCommercialDatabase } from "./recovery.js";
import { MAX_COMMERCIAL_DATABASE_BYTES } from "./recovery-crypto.js";
import {
  readPrivateRecoveryFile,
  syncRecoveryDirectory,
  writePrivateRecoveryFile,
} from "./recovery-files.js";
import { businessFingerprint, verifyReleasedRecoveryReview } from "./recovery-review.js";
import { readEnrollmentState, enrollmentEqual } from "./recovery-enrollment-state.js";
import { recoveryReadyProof } from "./recovery-credential-proofs.js";
import {
  parseNativeRelease,
  recoveryDigest,
  type NativeReleaseReceipt,
} from "./recovery-marker.js";
import { withNativeStoppedServiceCustody } from "./service-custody.js";
import { requireExternalHandoffPath } from "./handoff-paths.js";
import { handoffStateDigest } from "./handoff-state.js";
import {
  NATIVE_HANDOFF_SQL,
  NATIVE_HANDOFF_HISTORY_SQL,
  PUBLIC_HANDOFF_CONFIRMATION,
  bindNativeHandoff,
  handoffDigest,
  parseNativeHandoff,
  sealNativeHandoff,
  type NativeHandoffReceipt,
} from "./handoff-marker.js";

const maximumIntent = 32768;
type Hooks = {
  at?: (
    stage:
      | "prepared"
      | "before-fence"
      | "after-fence"
      | "before-public-authority"
      | "before-package-copy"
      | "before-ready"
      | "after-key-link"
      | "after-manifest-link"
      | "after-ready-link",
  ) => Promise<void>;
};
async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Public handoff needs private real directories");
  return info;
}
async function packageIdentity(path: string, receipt: NativeHandoffReceipt) {
  const info = await privateDirectory(path);
  if (
    (await realpath(path)) !== receipt.packagePath ||
    String(info.dev) !== receipt.packageDevice ||
    String(info.ino) !== receipt.packageInode
  )
    throw new Error("Public handoff package identity changed");
}
async function saveExact(path: string, value: string, afterLink?: () => Promise<void>) {
  const parent = dirname(path),
    publication = join(parent, ".publication"),
    name = basename(path);
  const existing = async () => {
    const info = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return false;
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      ![1, 2].includes(info.nlink)
    )
      throw new Error("Existing handoff publication is unsafe");
    if (info.nlink === 2) {
      await privateDirectory(publication);
      const entries = await readdir(publication);
      if (entries.length > 128) throw new Error("Interrupted publication needs an operator audit");
      let owned: string | undefined;
      for (const entry of entries) {
        if (!entry.startsWith(name + "-") || !/^[a-f0-9-]{36}$/.test(entry.slice(name.length + 1)))
          continue;
        const candidate = join(publication, entry),
          other = await lstat(candidate);
        if (
          !other.isSymbolicLink() &&
          other.isFile() &&
          other.dev === info.dev &&
          other.ino === info.ino &&
          other.nlink === 2
        ) {
          if (owned) throw new Error("Ambiguous private publication");
          owned = candidate;
        }
      }
      if (!owned) throw new Error("Interrupted publication has no matching private inode");
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await file.stat();
        const parts: Buffer[] = [];
        let size = 0;
        if (before.size > maximumIntent || before.size !== Buffer.byteLength(value))
          throw new Error("Interrupted publication differs");
        for (;;) {
          const chunk = Buffer.alloc(Math.min(16384, maximumIntent + 1 - size)),
            { bytesRead } = await file.read(chunk);
          if (!bytesRead) break;
          size += bytesRead;
          if (size > maximumIntent) throw new Error("Interrupted publication exceeds its boundary");
          parts.push(chunk.subarray(0, bytesRead));
        }
        if (
          before.dev !== info.dev ||
          before.ino !== info.ino ||
          before.size !== Buffer.byteLength(value) ||
          before.size > maximumIntent ||
          !Buffer.concat(parts, size).equals(Buffer.from(value))
        )
          throw new Error("Interrupted publication differs");
        const after = await file.stat(),
          current = await lstat(path),
          staged = await lstat(owned);
        if (
          after.size !== before.size ||
          after.ctimeMs !== before.ctimeMs ||
          after.mtimeMs !== before.mtimeMs ||
          after.nlink !== 2 ||
          current.ino !== before.ino ||
          current.dev !== before.dev ||
          current.isSymbolicLink() ||
          staged.ino !== before.ino ||
          staged.dev !== before.dev ||
          staged.isSymbolicLink()
        )
          throw new Error("Interrupted publication changed");
      } finally {
        await file.close();
      }
      await unlink(owned);
      await syncRecoveryDirectory(publication);
      await syncRecoveryDirectory(parent);
    }
    if ((await readPrivateRecoveryFile(path, maximumIntent)).toString("utf8") !== value)
      throw new Error("Existing handoff publication differs");
    return true;
  };
  if (await existing()) return;
  try {
    await mkdir(publication, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await privateDirectory(publication);
  }
  const staged = join(publication, `${name}-${randomUUID()}`);
  await writePrivateRecoveryFile(staged, value);
  let linked = false;
  try {
    await link(staged, path);
    linked = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (linked) await afterLink?.();
  await unlink(staged);
  await syncRecoveryDirectory(publication);
  await syncRecoveryDirectory(parent);
  if (!(await existing())) throw new Error("Handoff publication did not finish");
}
async function activeHandoff(database: NativeCommercialDatabase, secret: string) {
  if (
    !(await database
      .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff'")
      .first())
  )
    return null;
  const raw = await database
    .prepare("SELECT receipt_json FROM _chargeos_native_handoff WHERE id=1")
    .first<string>("receipt_json");
  if (!raw) throw new Error("Public handoff authority is incomplete");
  return { raw, receipt: parseNativeHandoff(raw, secret) };
}
async function originalRelease(
  database: NativeCommercialDatabase,
  secret: string,
  retired?: NativeHandoffReceipt,
): Promise<{ raw: string; receipt: NativeReleaseReceipt }> {
  const raw = retired
    ? await database
        .prepare("SELECT receipt_json FROM _chargeos_native_release_history WHERE release_id=?")
        .bind(retired.releaseId)
        .first<string>("receipt_json")
    : await database
        .prepare("SELECT receipt_json FROM _chargeos_native_release WHERE id=1")
        .first<string>("receipt_json");
  if (!raw) throw new Error("Public handoff needs a committed reviewed release");
  const receipt = parseNativeRelease(raw, secret);
  if (receipt.schemaVersion !== 2)
    throw new Error(
      "Public handoff requires a fresh reviewed release with versioned history binding",
    );
  return { raw, receipt };
}
async function freshReview(
  database: NativeCommercialDatabase,
  directory: string,
  manifest: string,
  release: NativeReleaseReceipt,
  secret: string,
) {
  const loaded = await readEnrollmentState(directory, secret),
    state = loaded.state;
  if (
    recoveryDigest(loaded.serialized) !== release.enrollmentSha256 ||
    state.restoreId !== release.restoreId ||
    state.epoch !== release.enrollmentEpoch ||
    state.origin !== release.origin ||
    state.reviewSha256 !== release.reviewSha256 ||
    state.provenanceSha256 !== release.provenanceSha256 ||
    state.users.length !== release.selectedUsers ||
    Date.parse(state.expiresAt) <= Date.now()
  )
    throw new Error("Public handoff requires the same fresh reviewed enrollment");
  for (const user of state.users)
    if (
      user.phase !== "ready" ||
      !user.readySha256 ||
      !enrollmentEqual(await recoveryReadyProof(database, secret, state, user), user.readySha256)
    )
      throw new Error("Fresh recovery credentials changed before public handoff");
  await verifyReleasedRecoveryReview(database, manifest, release, state);
  if ((await businessFingerprint(database, release.releaseId)) !== release.afterBusinessSha256)
    throw new Error("Released identities or financial records changed before public handoff");
}
async function addHandoff(
  database: NativeCommercialDatabase,
  serialized: string,
  expectedState?: string,
  retire = false,
) {
  const receipt = JSON.parse(serialized).receipt as NativeHandoffReceipt;
  const statements: D1PreparedStatement[] = [],
    changes: number[] = [];
  if (
    !(await database
      .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff_history'")
      .first())
  ) {
    statements.push(database.prepare(NATIVE_HANDOFF_HISTORY_SQL));
    changes.push(0);
  }
  statements.push(
    database.prepare(NATIVE_HANDOFF_SQL),
    database
      .prepare("INSERT INTO _chargeos_native_handoff_history VALUES(?,?)")
      .bind(receipt.handoffId, serialized),
    database.prepare("INSERT INTO _chargeos_native_handoff VALUES(1,?)").bind(serialized),
  );
  changes.push(0, 1, 1);
  if (retire) {
    statements.push(database.prepare("DELETE FROM _chargeos_native_release WHERE id=1"));
    changes.push(1);
  }
  database.checkedBatch(statements, changes, expectedState);
}
async function validateCandidate(
  database: NativeCommercialDatabase,
  receipt: NativeHandoffReceipt,
  secret: string,
  publicAuthority: boolean,
) {
  await inspectNativeCommercialDatabase(database, "released");
  const state = database.recoveryState(
    secret,
    false,
    publicAuthority ? receipt.targetOrigin : receipt.sourceOrigin,
  );
  if (
    state !== "released" ||
    (await handoffStateDigest(database, receipt.handoffId)) !== receipt.candidateStateSha256
  )
    throw new Error("Prepared public candidate state changed");
}
async function preflightFinished(
  candidate: NativeCommercialDatabase,
  receipt: NativeHandoffReceipt,
  serializedPublic: string,
  secret: string,
) {
  const path = await mkdtemp(join(tmpdir(), "chargeos-public-preflight-"));
  let copy: NativeCommercialDatabase | undefined;
  try {
    await candidate.snapshotTo(path);
    copy = new NativeCommercialDatabase(path, { recoveryInspection: true });
    await addHandoff(copy, serializedPublic);
    await validateCandidate(copy, receipt, secret, true);
  } finally {
    copy?.close();
    await rm(path, { recursive: true, force: true });
  }
}

/** One-way stopped-source transfer. Every stage after the durable intent is
 * retained on failure; retry can only finish the same package and authority. */
export async function prepareNativePublicHandoff(
  configuration: ServiceSettings,
  directory: string,
  manifest: string,
  target: string,
  origin: string,
  confirmation: string,
  hooks: Hooks = {},
) {
  const config = localConfiguration(configuration);
  if (
    !config ||
    !publicServiceOrigin(origin) ||
    confirmation !== PUBLIC_HANDOFF_CONFIRMATION ||
    config.secret.trim() !== config.secret ||
    /[\0\r\n]/.test(config.secret) ||
    Buffer.byteLength(config.secret) > 4096
  )
    throw new Error("Explicit exact-origin public handoff authorization is required");
  directory = await realpath(directory);
  await requireExternalHandoffPath(directory);
  await requireExternalHandoffPath(manifest);
  const parent = await realpath(dirname(resolve(target)));
  await privateDirectory(parent);
  target = join(parent, basename(resolve(target)));
  await requireExternalHandoffPath(target);
  const inside = relative(directory, target);
  if (inside === "" || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside)))
    throw new Error("Keep the public package outside source data and lifecycle custody");
  return withNativeStoppedServiceCustody(directory, async () => {
    const database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
    let candidate: NativeCommercialDatabase | undefined;
    try {
      const h = await activeHandoff(database, config.secret);
      if (
        h &&
        (h.receipt.role !== "source-retired" ||
          h.receipt.packagePath !== target ||
          h.receipt.targetOrigin !== origin)
      )
        throw new Error("This source already belongs to another handoff");
      const state = database.recoveryState(config.secret, false, config.origin);
      if (state !== (h ? "retired" : "released"))
        throw new Error("Public handoff requires this reviewed stopped recovery");
      const release = await originalRelease(database, config.secret, h?.receipt);
      let receipt: NativeHandoffReceipt, sourceSealed: string;
      let created = false;
      try {
        await mkdir(target, { mode: 0o700 });
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const info = await privateDirectory(target);
      if (created) {
        if (h) throw new Error("Retired source is missing its original prepared package");
        await inspectNativeCommercialDatabase(database, "released");
        await freshReview(database, directory, manifest, release.receipt, config.secret);
        const handoffId = randomUUID();
        const sourceStateSha256 = await handoffStateDigest(database, handoffId);
        await mkdir(join(target, "data"), { mode: 0o700 });
        await database.snapshotTo(join(target, "data"));
        candidate = new NativeCommercialDatabase(join(target, "data"), {
          recoveryInspection: true,
        });
        await candidate.prepare("PRAGMA secure_delete=ON").run();
        await candidate.batch([
          ...["session", "verification", "local_outbox", "rate_limit"].map((table) =>
            candidate!.prepare(`DELETE FROM ${table}`),
          ),
          candidate.prepare("UPDATE invitation SET status='revoked' WHERE status='pending'"),
        ]);
        await candidate.prepare("VACUUM").run();
        const existingHandoffs = await candidate
          .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff_history'")
          .first();
        if (
          existingHandoffs &&
          (await candidate
            .prepare("SELECT count(*) AS n FROM _chargeos_native_handoff_history")
            .first<number>("n"))! >= 1000
        )
          throw new Error("Public handoff history exceeds its boundary");
        receipt = {
          format: "chargeos-native-public-handoff",
          schemaVersion: 1,
          handoffId,
          role: "source-retired",
          restoreId: release.receipt.restoreId,
          releaseId: release.receipt.releaseId,
          releaseSha256: handoffDigest(release.raw),
          sourceOrigin: config.origin,
          targetOrigin: origin,
          packagePath: target,
          packageDevice: String(info.dev),
          packageInode: String(info.ino),
          preparedAt: new Date().toISOString(),
          sourceStateSha256,
          candidateStateSha256: await handoffStateDigest(candidate, handoffId),
          priorHistorySha256: release.receipt.handoffHistorySha256!,
          reviewSha256: release.receipt.reviewSha256,
          enrollmentSha256: release.receipt.enrollmentSha256,
          sourceRetirement: null,
          operatorAttestation: confirmation,
        };
        sourceSealed = sealNativeHandoff(receipt, config.secret);
        const pub = sealNativeHandoff(
          { ...receipt, role: "public-install", sourceRetirement: sourceSealed },
          config.secret,
        );
        await validateCandidate(candidate, receipt, config.secret, false);
        await preflightFinished(candidate, receipt, pub, config.secret);
        candidate.close();
        candidate = undefined;
        await writePrivateRecoveryFile(join(target, "intent.json"), sourceSealed);
        await syncRecoveryDirectory(join(target, "data"));
        await syncRecoveryDirectory(target);
        await syncRecoveryDirectory(parent);
        await hooks.at?.("prepared");
      } else {
        sourceSealed = (
          await readPrivateRecoveryFile(join(target, "intent.json"), maximumIntent)
        ).toString("utf8");
        receipt = parseNativeHandoff(sourceSealed, config.secret);
        if (
          receipt.role !== "source-retired" ||
          receipt.targetOrigin !== origin ||
          receipt.sourceOrigin !== config.origin
        )
          throw new Error("Prepared handoff belongs to another destination");
      }
      await packageIdentity(target, receipt);
      bindNativeHandoff(receipt, release.receipt, release.raw);
      if ((await handoffStateDigest(database, receipt.handoffId)) !== receipt.sourceStateSha256)
        throw new Error("Stopped source changed after handoff preparation");
      if (h && h.raw !== sourceSealed)
        throw new Error("Source retirement differs from prepared intent");
      candidate = new NativeCommercialDatabase(join(target, "data"), {
        recoveryInspection: true,
      });
      const publicSealed = sealNativeHandoff(
        { ...receipt, role: "public-install", sourceRetirement: sourceSealed },
        config.secret,
      );
      const candidateH = await activeHandoff(candidate, config.secret);
      if (candidateH && (!h || candidateH.raw !== publicSealed))
        throw new Error("Candidate authority differs from this committed source");
      await validateCandidate(candidate, receipt, config.secret, !!candidateH);
      if (!h) {
        await freshReview(database, directory, manifest, release.receipt, config.secret);
        await preflightFinished(candidate, receipt, publicSealed, config.secret);
        await hooks.at?.("before-fence");
        // Re-evaluate actual files/credentials/time at cutover. The transaction's
        // full state guard additionally binds every source auth/business row.
        const guarded = database.stateDigest();
        await freshReview(database, directory, manifest, release.receipt, config.secret);
        await packageIdentity(target, receipt);
        if ((await handoffStateDigest(database, receipt.handoffId)) !== receipt.sourceStateSha256)
          throw new Error("Source changed before public cutover");
        await addHandoff(database, sourceSealed, guarded, true);
        if (database.recoveryState(config.secret, false, config.origin) !== "retired")
          throw new Error("Source retirement did not authenticate");
        await syncRecoveryDirectory(directory);
        await hooks.at?.("after-fence");
      }
      if (!candidateH) {
        await hooks.at?.("before-public-authority");
        await addHandoff(candidate, publicSealed);
      }
      await validateCandidate(candidate, receipt, config.secret, true);
      await packageIdentity(target, receipt);
      await hooks.at?.("before-package-copy");
      // The durable candidate is the final capsule database; no second backup
      // can leave a partial final file after the source fence commits.
      const data = join(target, "data");
      const finished = new NativeCommercialDatabase(data, { recoveryInspection: true });
      try {
        const actual = await activeHandoff(finished, config.secret);
        if (actual?.raw !== publicSealed) throw new Error("Published package has another handoff");
        await validateCandidate(finished, receipt, config.secret, true);
      } finally {
        finished.close();
      }
      const bytes = await readPrivateRecoveryFile(
        join(data, "commercial.sqlite"),
        MAX_COMMERCIAL_DATABASE_BYTES,
      );
      const installation = {
        format: "chargeos-native-public-install",
        schemaVersion: 1,
        handoffId: receipt.handoffId,
        releaseId: receipt.releaseId,
        origin,
        databaseSha256: handoffDigest(bytes),
        handoffSha256: handoffDigest(publicSealed),
      };
      await saveExact(join(target, "auth.key"), config.secret, async () =>
        hooks.at?.("after-key-link"),
      );
      await saveExact(join(target, "install.json"), JSON.stringify(installation), async () =>
        hooks.at?.("after-manifest-link"),
      );
      await hooks.at?.("before-ready");
      await packageIdentity(target, receipt);
      await validateCandidate(candidate, receipt, config.secret, true);
      if (
        handoffDigest(
          await readPrivateRecoveryFile(
            join(data, "commercial.sqlite"),
            MAX_COMMERCIAL_DATABASE_BYTES,
          ),
        ) !== installation.databaseSha256
      )
        throw new Error("Capsule bytes changed before ready publication");
      if ((await handoffStateDigest(database, receipt.handoffId)) !== receipt.sourceStateSha256)
        throw new Error("Retired source changed before final publication");
      await saveExact(
        join(target, "READY"),
        JSON.stringify({
          format: "chargeos-public-handoff-ready",
          schemaVersion: 1,
          handoffId: receipt.handoffId,
          installationSha256: handoffDigest(JSON.stringify(installation)),
        }),
        async () => hooks.at?.("after-ready-link"),
      );
      await syncRecoveryDirectory(data);
      await syncRecoveryDirectory(target);
      await syncRecoveryDirectory(parent);
      return {
        status: "prepared" as const,
        handoffId: receipt.handoffId,
        origin,
        directory: target,
        sourceState: "retired" as const,
      };
    } finally {
      candidate?.close();
      database.close();
    }
  });
}
