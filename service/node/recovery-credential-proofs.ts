import { HttpError } from "../http.js";
import type { NativeCommercialDatabase } from "./sqlite.js";
import {
  enrollmentMac,
  enrollmentSha,
  type EnrollmentState,
  type EnrollmentUser,
} from "./recovery-enrollment-state.js";

export async function recoveryPasswordProof(
  database: NativeCommercialDatabase,
  user: EnrollmentUser,
): Promise<string> {
  const accounts = await database
    .prepare(
      "SELECT id,account_id,provider_id,user_id,password,created_at,updated_at FROM account WHERE user_id=? ORDER BY id",
    )
    .bind(user.userId)
    .all<{
      provider_id: string;
      password: string | null;
      created_at: number;
      account_id: string;
    }>();
  if (
    accounts.results.length !== 1 ||
    accounts.results[0]!.provider_id !== "credential" ||
    !accounts.results[0]!.password ||
    accounts.results[0]!.account_id !== user.userId ||
    accounts.results[0]!.created_at < Date.parse(user.issuedAt)
  )
    throw new HttpError(409, "Your setup needs a new private link from the administrator");
  return enrollmentSha(JSON.stringify(accounts.results));
}
export async function recoveryTotpProof(
  database: NativeCommercialDatabase,
  user: EnrollmentUser,
): Promise<string> {
  const factors = await database
    .prepare("SELECT id,user_id,secret,backup_codes FROM two_factor WHERE user_id=? ORDER BY id")
    .bind(user.userId)
    .all();
  if (factors.results.length !== 1)
    throw new HttpError(409, "Your authenticator setup needs a new private link");
  return enrollmentSha(JSON.stringify(factors.results));
}
export async function recoveryReadyProof(
  database: NativeCommercialDatabase,
  secret: string,
  state: EnrollmentState,
  user: EnrollmentUser,
): Promise<string> {
  const record = await database
    .prepare("SELECT email,email_verified,two_factor_enabled FROM user WHERE id=?")
    .bind(user.userId)
    .first<{ email: string; email_verified: number; two_factor_enabled: number }>();
  const factor = await database
    .prepare("SELECT verified,locked_until FROM two_factor WHERE user_id=?")
    .bind(user.userId)
    .first<{ verified: number; locked_until: number | null }>();
  const credential = await recoveryPasswordProof(database, user),
    totp = await recoveryTotpProof(database, user);
  if (
    !record ||
    record.email !== user.email ||
    record.email_verified !== 1 ||
    record.two_factor_enabled !== 1 ||
    !factor?.verified ||
    (factor.locked_until ?? 0) > Date.now() ||
    credential !== user.passwordSha256 ||
    totp !== user.totpSha256
  )
    throw new HttpError(409, "Fresh credential verification is incomplete or has changed");
  return enrollmentMac(
    secret,
    "credential-proof",
    JSON.stringify({
      epoch: state.epoch,
      reviewSha256: state.reviewSha256,
      nonce: user.nonce,
      userId: user.userId,
      email: user.email,
      credential,
      totp,
    }),
  );
}
