import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { localConfiguration, type ServiceEnv } from "../auth.js";
import { exactObject } from "./recovery-crypto.js";
import {
  readPrivateRecoveryFile,
  syncRecoveryDirectory,
  writePrivateRecoveryFile,
} from "./recovery-files.js";
import {
  evaluateNativeRecoveryReview,
  requirePersistentRecoveryOutput,
  withNativeRecoveryCustody,
  type EvaluatedNativeRecoveryReview,
} from "./recovery-review.js";
import { NativeCommercialDatabase } from "./sqlite.js";

export type EnrollmentPhase = "issued" | "claimed" | "password-set" | "ready" | "failed";
export interface EnrollmentUser {
  userId: string;
  email: string;
  nonce: string;
  tokenSha256: string | null;
  issuedAt: string;
  phase: EnrollmentPhase;
  passwordSha256: string | null;
  totpSha256: string | null;
  readySha256: string | null;
  verifiedAt: string | null;
}
export interface EnrollmentState {
  epoch: string;
  restoreId: string;
  reviewSha256: string;
  businessSha256: string;
  provenanceSha256: string;
  origin: string;
  expiresAt: string;
  users: EnrollmentUser[];
}
const MAX_STATE_BYTES = 4 * 1024 * 1024;
export const enrollmentSha = (value: string) => createHash("sha256").update(value).digest("hex");
const statePath = (directory: string) => join(directory, ".recovery-enrollment.json");
const canonical = (value: unknown) => JSON.stringify(value);
export function enrollmentMac(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret)
    .update(`chargeos-native-recovery-enrollment:1:${purpose}\0`)
    .update(value)
    .digest("hex");
}
export function enrollmentEqual(a: string, b: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export function enrollmentTokenHash(state: EnrollmentState, token: string): string {
  return enrollmentSha(`activation:${state.epoch}:${token}`);
}
async function requireLinkOutput(directory: string, output: string): Promise<void> {
  await requirePersistentRecoveryOutput(directory, output);
  const data = await realpath(directory),
    parent = await realpath(dirname(output)),
    inside = relative(data, parent),
    info = await lstat(parent);
  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    inside === "" ||
    (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  )
    throw new Error(
      "Private enrollment links need a separate owner-private directory outside service data",
    );
}
async function removeOwned(path: string, created: { dev: number; ino: number }): Promise<void> {
  const current = await lstat(path).catch(() => null);
  if (
    current &&
    !current.isSymbolicLink() &&
    current.dev === created.dev &&
    current.ino === created.ino
  )
    await rm(path);
}
function selectedUsers(review: EvaluatedNativeRecoveryReview) {
  const selected = new Map<string, string>();
  for (const org of review.report.organizations)
    for (const member of org.members)
      if (member.decision === "keep") {
        const previous = selected.get(member.userId);
        if (previous !== undefined && previous !== member.email)
          throw new Error("Conflicting reviewed identity");
        selected.set(member.userId, member.email);
      }
  return [...selected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
function parseState(value: unknown): EnrollmentState {
  exactObject(value, [
    "epoch",
    "restoreId",
    "reviewSha256",
    "businessSha256",
    "provenanceSha256",
    "origin",
    "expiresAt",
    "users",
  ]);
  for (const key of ["epoch", "restoreId", "origin", "expiresAt"])
    if (typeof value[key] !== "string" || value[key].length > 4096)
      throw new Error("Invalid enrollment state");
  for (const key of ["reviewSha256", "businessSha256", "provenanceSha256"])
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key]))
      throw new Error("Invalid enrollment binding");
  if (!Array.isArray(value.users) || value.users.length > 10000)
    throw new Error("Invalid enrollment users");
  const ids = new Set<string>();
  for (const user of value.users) {
    exactObject(user, [
      "userId",
      "email",
      "nonce",
      "tokenSha256",
      "issuedAt",
      "phase",
      "passwordSha256",
      "totpSha256",
      "readySha256",
      "verifiedAt",
    ]);
    for (const key of ["userId", "email", "nonce", "issuedAt"])
      if (typeof user[key] !== "string" || !user[key].length || user[key].length > 4096)
        throw new Error("Invalid enrollment identity");
    if (
      ids.has(user.userId as string) ||
      !["issued", "claimed", "password-set", "ready", "failed"].includes(String(user.phase))
    )
      throw new Error("Invalid enrollment phase");
    ids.add(user.userId as string);
    for (const key of ["tokenSha256", "passwordSha256", "totpSha256", "readySha256"])
      if (
        user[key] !== null &&
        (typeof user[key] !== "string" || !/^[a-f0-9]{64}$/.test(user[key]))
      )
        throw new Error("Invalid enrollment proof");
    if (
      user.verifiedAt !== null &&
      (typeof user.verifiedAt !== "string" || !Number.isFinite(Date.parse(user.verifiedAt)))
    )
      throw new Error("Invalid enrollment verification time");
  }
  return value as unknown as EnrollmentState;
}
export function bindEnrollment(
  state: EnrollmentState,
  review: EvaluatedNativeRecoveryReview,
  origin: string,
): void {
  if (
    state.restoreId !== review.restoreId ||
    state.reviewSha256 !== review.reviewSha256 ||
    state.businessSha256 !== review.report.businessSha256 ||
    state.provenanceSha256 !== review.report.provenanceSha256 ||
    state.origin !== origin ||
    state.expiresAt !== review.report.expiresAt ||
    Date.parse(state.expiresAt) <= Date.now() ||
    canonical(state.users.map((user) => [user.userId, user.email])) !==
      canonical(selectedUsers(review))
  )
    throw new Error("Enrollment no longer matches the current recovery review");
}
export async function readEnrollmentState(
  directory: string,
  secret: string,
): Promise<{ state: EnrollmentState; serialized: string }> {
  const serialized = (
    await readPrivateRecoveryFile(statePath(directory), MAX_STATE_BYTES)
  ).toString("utf8");
  const envelope: unknown = JSON.parse(serialized);
  exactObject(envelope, ["format", "schemaVersion", "state", "mac"]);
  if (
    envelope.format !== "chargeos-native-recovery-enrollment" ||
    envelope.schemaVersion !== 1 ||
    typeof envelope.mac !== "string" ||
    !enrollmentEqual(envelope.mac, enrollmentMac(secret, "state", canonical(envelope.state)))
  )
    throw new Error("Enrollment authentication failed");
  return { state: parseState(envelope.state), serialized };
}
export async function persistEnrollmentState(
  directory: string,
  secret: string,
  state: EnrollmentState,
  previous: string | null,
): Promise<string> {
  parseState(state);
  const serialized =
    JSON.stringify({
      format: "chargeos-native-recovery-enrollment",
      schemaVersion: 1,
      state,
      mac: enrollmentMac(secret, "state", canonical(state)),
    }) + "\n";
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES)
    throw new Error("Enrollment state exceeds its boundary");
  const path = statePath(directory),
    temporary = join(directory, `.recovery-enrollment-${randomUUID()}.tmp`);
  await writePrivateRecoveryFile(temporary, serialized);
  try {
    if (previous === null) {
      // Initial create must never replace an existing or linked state file.
      await writePrivateRecoveryFile(path, serialized);
    } else {
      const before = await lstat(path);
      if ((await readPrivateRecoveryFile(path, MAX_STATE_BYTES)).toString("utf8") !== previous)
        throw new Error("Enrollment state changed concurrently");
      const current = await lstat(path);
      if (before.dev !== current.dev || before.ino !== current.ino)
        throw new Error("Enrollment state was replaced");
      await rename(temporary, path);
      await syncRecoveryDirectory(directory);
    }
    return serialized;
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function issueNativeRecoveryEnrollment(
  configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
  directory: string,
  manifestFile: string,
  output: string,
  replaceAll = false,
) {
  const config = localConfiguration(configuration);
  if (!config) throw new Error("Use the restored local configuration");
  return withNativeRecoveryCustody(directory, async () => {
    await requireLinkOutput(directory, output);
    const review = await evaluateNativeRecoveryReview(directory, manifestFile);
    let previous: string | null = null;
    try {
      previous = (await readEnrollmentState(directory, config.secret)).serialized;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous !== null && !replaceAll)
      throw new Error("Enrollment already exists; use explicit reviewed reissue");
    if (previous === null && replaceAll)
      throw new Error("There is no existing enrollment to reissue");
    if (
      previous !== null &&
      (await readEnrollmentState(directory, config.secret)).state.restoreId !== review.restoreId
    )
      throw new Error("Enrollment belongs to a different restore");
    const epoch = randomUUID(),
      state: EnrollmentState = {
        epoch,
        restoreId: review.restoreId,
        reviewSha256: review.reviewSha256,
        businessSha256: review.report.businessSha256,
        provenanceSha256: review.report.provenanceSha256,
        origin: config.origin,
        expiresAt: review.report.expiresAt,
        users: [],
      };
    const links: { email: string; url: string }[] = [];
    for (const [userId, email] of selectedUsers(review)) {
      const token = randomBytes(32).toString("hex");
      state.users.push({
        userId,
        email,
        nonce: randomUUID(),
        issuedAt: new Date().toISOString(),
        tokenSha256: enrollmentTokenHash(state, token),
        phase: "issued",
        passwordSha256: null,
        totpSha256: null,
        readySha256: null,
        verifiedAt: null,
      });
      links.push({ email, url: `${config.origin}/service/recovery#enroll=${token}` });
    }
    // A new reviewed epoch invalidates every old credential, including users
    // omitted by the current keep set. No stale account can survive a restart.
    await writePrivateRecoveryFile(
      output,
      JSON.stringify(
        {
          format: "chargeos-private-recovery-enrollment-links",
          schemaVersion: 1,
          epoch,
          expiresAt: state.expiresAt,
          links,
        },
        null,
        2,
      ) + "\n",
    );
    const created = await lstat(output);
    let database: NativeCommercialDatabase | undefined;
    try {
      database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
      await database.prepare("PRAGMA secure_delete=ON").run();
      await database.batch(
        ["session", "verification", "local_outbox", "account", "two_factor", "rate_limit"]
          .map((table) => database!.prepare(`DELETE FROM ${table}`))
          .concat([database.prepare("UPDATE user SET email_verified=0,two_factor_enabled=0")]),
      );
      await database.prepare("VACUUM").run();
      await persistEnrollmentState(directory, config.secret, state, previous);
      return {
        status: "enrollment-links-issued",
        users: links.length,
        expiresAt: state.expiresAt,
        reopeningAllowed: false,
      };
    } catch (error) {
      await removeOwned(output, created);
      throw error;
    } finally {
      database?.close();
    }
  });
}

export async function reissueNativeRecoveryEnrollmentUser(
  configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
  directory: string,
  manifestFile: string,
  email: string,
  output: string,
) {
  const config = localConfiguration(configuration);
  if (!config) throw new Error("Use the restored local configuration");
  return withNativeRecoveryCustody(directory, async () => {
    await requireLinkOutput(directory, output);
    const review = await evaluateNativeRecoveryReview(directory, manifestFile),
      loaded = await readEnrollmentState(directory, config.secret);
    bindEnrollment(loaded.state, review, config.origin);
    const user = loaded.state.users.find((item) => item.email === email);
    if (!user) throw new Error("Only a current reviewed identity may receive a replacement link");
    const token = randomBytes(32).toString("hex");
    Object.assign(user, {
      nonce: randomUUID(),
      issuedAt: new Date().toISOString(),
      tokenSha256: enrollmentTokenHash(loaded.state, token),
      phase: "issued",
      passwordSha256: null,
      totpSha256: null,
      readySha256: null,
      verifiedAt: null,
    });
    await writePrivateRecoveryFile(
      output,
      JSON.stringify(
        {
          format: "chargeos-private-recovery-enrollment-links",
          schemaVersion: 1,
          epoch: loaded.state.epoch,
          expiresAt: loaded.state.expiresAt,
          links: [{ email, url: `${config.origin}/service/recovery#enroll=${token}` }],
        },
        null,
        2,
      ) + "\n",
    );
    const created = await lstat(output);
    let database: NativeCommercialDatabase | undefined;
    try {
      database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
      await database.prepare("PRAGMA secure_delete=ON").run();
      await database.batch([
        ...["session", "account", "two_factor"].map((table) =>
          database!.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.userId),
        ),
        database.prepare("DELETE FROM verification"),
        database.prepare("DELETE FROM local_outbox"),
        database
          .prepare("UPDATE user SET email_verified=0,two_factor_enabled=0 WHERE id=?")
          .bind(user.userId),
      ]);
      await database.prepare("VACUUM").run();
      await persistEnrollmentState(directory, config.secret, loaded.state, loaded.serialized);
      return {
        status: "enrollment-link-reissued",
        users: 1,
        expiresAt: loaded.state.expiresAt,
        reopeningAllowed: false,
      };
    } catch (error) {
      await removeOwned(output, created);
      throw error;
    } finally {
      database?.close();
    }
  });
}
