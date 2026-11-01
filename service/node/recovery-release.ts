import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localConfiguration, type ServiceEnv } from "../auth.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import { handoffHistoryDigest } from "./handoff-marker.js";
import {
  businessFingerprint,
  evaluateNativeRecoveryReview,
  withNativeRecoveryCustody,
} from "./recovery-review.js";
import {
  bindEnrollment,
  enrollmentEqual,
  readEnrollmentState,
} from "./recovery-enrollment-state.js";
import { recoveryReadyProof } from "./recovery-credential-proofs.js";
import { inspectNativeCommercialDatabase } from "./recovery.js";
import {
  NATIVE_RECOVERY_RELEASE_SQL,
  NATIVE_RECOVERY_HISTORY_SQL,
  RECOVERY_RELEASE_CONFIRMATION,
  recoveryDigest,
  recoveryHistoryDigest,
  sealNativeRelease,
  type NativeReleaseReceipt,
} from "./recovery-marker.js";

/** Releases only this stopped local commercial restore. Owner authority and
 * charger configuration are outside this database and operation. */
export async function releaseNativeCommercialRecovery(
  configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
  directory: string,
  manifestFile: string,
  confirmation: string,
) {
  const config = localConfiguration(configuration);
  if (!config || confirmation !== RECOVERY_RELEASE_CONFIRMATION)
    throw new Error("Explicit reviewed recovery release confirmation is required");
  return withNativeRecoveryCustody(directory, async () => {
    const database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
    let scratch: string | undefined, copy: NativeCommercialDatabase | undefined;
    try {
      if (database.recoveryState(config.secret, false, config.origin) === "released") {
        // A crash after COMMIT must never apply offboarding twice. The live
        // receipt authenticates this result without needing expired inputs.
        const stored = await database
          .prepare("SELECT receipt_json FROM _chargeos_native_release WHERE id=1")
          .first<string>("receipt_json");
        const { receipt } = JSON.parse(stored!) as { receipt: NativeReleaseReceipt };
        return {
          status: "already-released",
          restoreId: receipt.restoreId,
          releaseId: receipt.releaseId,
          enrollmentEpoch: receipt.enrollmentEpoch,
        };
      }
      const beforeState = database.stateDigest();
      const review = await evaluateNativeRecoveryReview(directory, manifestFile),
        loaded = await readEnrollmentState(directory, config.secret),
        state = loaded.state;
      bindEnrollment(state, review, config.origin);
      for (const user of state.users) {
        if (
          user.phase !== "ready" ||
          user.tokenSha256 !== null ||
          !user.verifiedAt ||
          Date.parse(user.verifiedAt) < Date.parse(user.issuedAt) ||
          Date.parse(user.verifiedAt) > Date.now() ||
          !user.readySha256 ||
          !enrollmentEqual(
            await recoveryReadyProof(database, config.secret, state, user),
            user.readySha256,
          )
        )
          throw new Error("Every kept identity needs its current fresh credential proof");
      }
      const hasHistory = !!(await database
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_release_history'")
        .first());
      const historyRows = hasHistory
        ? await database
            .prepare("SELECT release_id,receipt_json FROM _chargeos_native_release_history")
            .all<{ release_id: string; receipt_json: string }>()
        : { results: [] };
      const priorHistorySha256 = recoveryHistoryDigest(
        historyRows.results.map((row) => [row.release_id, row.receipt_json]),
      );
      if (historyRows.results.length >= 1000)
        throw new Error("Recovery history exceeds its boundary");
      const hasHandoffHistory = await database
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff_history'")
        .first();
      const handoffRows = hasHandoffHistory
        ? (
            await database
              .prepare("SELECT handoff_id,receipt_json FROM _chargeos_native_handoff_history")
              .all<{ handoff_id: string; receipt_json: string }>()
          ).results
        : [];
      const releaseId = randomUUID(),
        releasedAt = new Date().toISOString(),
        now = Date.parse(releasedAt);
      const mutations: {
        sql: string;
        values: (string | number | null)[];
        changes: number | null;
      }[] = [];
      const add = (
        sql: string,
        values: (string | number | null)[] = [],
        changes: number | null = null,
      ) => mutations.push({ sql, values, changes });
      if (
        !(await database
          .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_release_history'")
          .first())
      )
        add(NATIVE_RECOVERY_HISTORY_SQL, [], 0);
      for (const org of review.report.organizations) {
        for (const member of org.members) {
          if (member.decision === "keep")
            add(
              "UPDATE membership SET role=? WHERE organization_id=? AND user_id=?",
              [member.role, org.organizationId, member.userId],
              1,
            );
          else
            add(
              "DELETE FROM membership WHERE organization_id=? AND user_id=?",
              [org.organizationId, member.userId],
              1,
            );
        }
        for (const end of org.eligibilityEnds) {
          if (end.expectedExistingUntil === null)
            add(
              "INSERT INTO reimbursement_assignment_end(assignment_id,effective_until,created_by,recovery_release_id,created_at) VALUES(?,?,NULL,?,?)",
              [end.assignmentId, Date.parse(end.effectiveUntil), releaseId, now],
              1,
            );
        }
        add(
          "INSERT INTO service_audit(id,organization_id,actor_id,recovery_release_id,action,subject_id,created_at) VALUES(?,?,NULL,?,'recovery.released',?,?)",
          [randomUUID(), org.organizationId, releaseId, releaseId, now],
          1,
        );
      }
      // Only the keep-union is eligible to sign in afterward. Clear all other
      // authentication, even auth-only rows excluded from the review digest.
      // IDs are staged as parameterized per-user decisions, never SQL input.
      const keep = new Set(state.users.map((user) => user.userId));
      const allUsers = await database.prepare("SELECT id FROM user").all<{ id: string }>();
      for (const user of allUsers.results)
        if (!keep.has(user.id)) {
          add("DELETE FROM account WHERE user_id=?", [user.id]);
          add("DELETE FROM two_factor WHERE user_id=?", [user.id]);
          add("UPDATE user SET email_verified=0,two_factor_enabled=0 WHERE id=?", [user.id], 1);
        }
      for (const table of ["session", "verification", "local_outbox", "rate_limit"])
        add(`DELETE FROM ${table}`);
      add("UPDATE invitation SET status='revoked' WHERE status='pending'");
      const apply = (target: NativeCommercialDatabase) =>
        target.checkedBatch(
          mutations.map((m) => target.prepare(m.sql).bind(...m.values)),
          mutations.map((m) => m.changes),
        );

      // Prove the complete deterministic transformation on a consistent copy
      // before changing the quarantined source. State and row-count guards run
      // inside the real BEGIN IMMEDIATE transaction, before receipt COMMIT.
      scratch = await mkdtemp(join(tmpdir(), "chargeos-release-preflight-"));
      await database.snapshotTo(scratch);
      copy = new NativeCommercialDatabase(scratch, { recoveryInspection: true });
      if (copy.stateDigest() !== beforeState)
        throw new Error("Recovery state changed during release review");
      apply(copy);
      await inspectNativeCommercialDatabase(copy, true);
      const afterBusinessSha256 = await businessFingerprint(copy);
      const receipt: NativeReleaseReceipt = {
        format: "chargeos-native-recovery-release",
        schemaVersion: 2,
        handoffHistorySha256: handoffHistoryDigest(
          handoffRows.map((row) => [row.handoff_id, row.receipt_json]),
        ),
        releaseId,
        restoreId: state.restoreId,
        enrollmentEpoch: state.epoch,
        releasedAt,
        origin: config.origin,
        provenanceSha256: state.provenanceSha256,
        reviewSha256: state.reviewSha256,
        enrollmentSha256: recoveryDigest(loaded.serialized),
        beforeBusinessSha256: state.businessSha256,
        afterBusinessSha256,
        decisions: review.report.organizations,
        priorHistorySha256,
        decisionsSha256: recoveryDigest(JSON.stringify(review.report.organizations)),
        organizations: review.report.organizations.length,
        selectedUsers: state.users.length,
        removedMemberships: review.removedMemberships,
        operatorAttestation: RECOVERY_RELEASE_CONFIRMATION,
      };
      const sealed = sealNativeRelease(receipt, config.secret);
      if (Buffer.byteLength(sealed) > 4 * 1024 * 1024)
        throw new Error("Recovery release receipt exceeds its boundary");
      const finish = (target: NativeCommercialDatabase) => [
        target.prepare(NATIVE_RECOVERY_RELEASE_SQL),
        target
          .prepare("INSERT INTO _chargeos_native_release_history VALUES(?,?)")
          .bind(releaseId, sealed),
        target.prepare("INSERT INTO _chargeos_native_release VALUES(1,?)").bind(sealed),
      ];
      copy.checkedBatch(finish(copy), [0, 1, 1]);
      if (
        copy.recoveryState(config.secret) !== "released" ||
        (await businessFingerprint(copy, releaseId)) !== afterBusinessSha256
      )
        throw new Error("Finished recovery release failed preflight verification");
      await inspectNativeCommercialDatabase(copy, "released");
      // Recheck time at the actual cutover, after bounded preflight work.
      const finalReview = await evaluateNativeRecoveryReview(directory, manifestFile);
      const finalEnrollment = await readEnrollmentState(directory, config.secret);
      if (
        finalReview.reviewSha256 !== review.reviewSha256 ||
        finalEnrollment.serialized !== loaded.serialized
      )
        throw new Error("Recovery review or enrollment changed during preflight");
      bindEnrollment(finalEnrollment.state, finalReview, config.origin);
      database.checkedBatch(
        [...mutations.map((m) => database.prepare(m.sql).bind(...m.values)), ...finish(database)],
        [...mutations.map((m) => m.changes), 0, 1, 1],
        beforeState,
      );
      return {
        status: "released",
        restoreId: state.restoreId,
        releaseId,
        enrollmentEpoch: state.epoch,
      };
    } finally {
      copy?.close();
      database.close();
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  });
}
