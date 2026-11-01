import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { createServiceAuth, localConfiguration, type ServiceEnv } from "../auth.js";
import { HttpError, json, objectInput } from "../http.js";
import type {
  RecoveryEnrollmentAuthentication,
  RecoveryEnrollmentAuthenticator,
  RecoveryEnrollmentStatus,
} from "../../shared/contracts.js";
import { evaluateNativeRecoveryReview } from "./recovery-review.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import {
  bindEnrollment,
  enrollmentEqual,
  enrollmentMac,
  enrollmentSha,
  enrollmentTokenHash,
  persistEnrollmentState,
  readEnrollmentState,
  type EnrollmentState,
  type EnrollmentUser,
} from "./recovery-enrollment-state.js";

const root = "/service/api/recovery/enrollment";
const challengeName = "chargeos-recovery.enrollment_challenge";
const factorName = "chargeos-recovery.two_factor";
const cookieAttributes = "Path=/service/api; HttpOnly; SameSite=Lax";
const expireChallenge = `${challengeName}=; ${cookieAttributes}; Max-Age=0`;
function secure(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
function cookies(headers: Headers): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (name.startsWith("chargeos-recovery.") && result.has(name))
      throw new HttpError(
        401,
        "Conflicting recovery cookies. Clear the recovery session and sign in again",
      );
    result.set(name, part.slice(at + 1));
  }
  return result;
}
function sessionHeaders(request: Request, result: Response): Headers {
  const headers = new Headers(request.headers),
    jar = cookies(headers);
  for (const line of result.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0]!,
      at = pair.indexOf("="),
      name = pair.slice(0, at),
      value = pair.slice(at + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
  return headers;
}
function responseWithCookies(value: unknown, source: Response): Response {
  const response = json(value);
  for (const line of source.headers.getSetCookie()) response.headers.append("set-cookie", line);
  return response;
}
async function body(request: Request, keys: string[]): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new HttpError(413, "This setup request is too large");
      }
      chunks.push(part.value);
    }
  try {
    return objectInput(JSON.parse(Buffer.concat(chunks).toString("utf8")), keys);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Use a JSON setup request");
  }
}
function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new HttpError(400, "Choose a new password with 12 to 128 characters");
  return value;
}

/** The caller retains lifecycle custody until its HTTP listener has drained and close() returns. */
export async function createNativeRecoveryEnrollment(
  directory: string,
  manifestFile: string,
  configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
) {
  const config = localConfiguration(configuration);
  if (!config) throw new Error("Use the restored local enrollment configuration");
  const initialReview = await evaluateNativeRecoveryReview(directory, manifestFile);
  const initial = await readEnrollmentState(directory, config.secret);
  bindEnrollment(initial.state, initialReview, config.origin);
  const database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
  const env: ServiceEnv = { ...configuration, SERVICE_DB: database },
    auth = createServiceAuth(env, "recovery-enrollment");
  let busy = false,
    failed = false;
  async function passwordProof(user: EnrollmentUser): Promise<string> {
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
  async function totpProof(user: EnrollmentUser): Promise<string> {
    const factors = await database
      .prepare("SELECT id,user_id,secret,backup_codes FROM two_factor WHERE user_id=? ORDER BY id")
      .bind(user.userId)
      .all();
    if (factors.results.length !== 1)
      throw new HttpError(409, "Your authenticator setup needs a new private link");
    return enrollmentSha(JSON.stringify(factors.results));
  }
  async function readyProof(state: EnrollmentState, user: EnrollmentUser): Promise<string> {
    const record = await database
      .prepare("SELECT email,email_verified,two_factor_enabled FROM user WHERE id=?")
      .bind(user.userId)
      .first<{ email: string; email_verified: number; two_factor_enabled: number }>();
    const factor = await database
      .prepare("SELECT verified,locked_until FROM two_factor WHERE user_id=?")
      .bind(user.userId)
      .first<{ verified: number; locked_until: number | null }>();
    const credential = await passwordProof(user),
      totp = await totpProof(user);
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
      config!.secret,
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
  async function budget(request: Request, scope = "all", maximum = 60): Promise<void> {
    const now = Date.now(),
      previous = now - 60000,
      key = `recovery-enrollment:${scope}:${request.headers.get("cf-connecting-ip") ?? "local"}`;
    await database
      .prepare(
        "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END",
      )
      .bind(randomUUID(), key, now, previous, previous, now)
      .run();
    const count = await database
      .prepare("SELECT count FROM rate_limit WHERE key=?")
      .bind(key)
      .first<number>("count");
    if ((count ?? maximum + 1) > maximum)
      throw new HttpError(429, "Too many setup attempts. Wait a minute and try again");
  }
  function challengeCookie(state: EnrollmentState, user: EnrollmentUser, factor: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        epoch: state.epoch,
        reviewSha256: state.reviewSha256,
        userId: user.userId,
        nonce: user.nonce,
        factorSha256: enrollmentSha(factor),
        expiresAt: Date.now() + 300000,
      }),
    ).toString("base64url");
    return `${challengeName}=${payload}.${enrollmentMac(config!.secret, "challenge", payload)}; ${cookieAttributes}; Max-Age=300`;
  }
  function challengeUser(state: EnrollmentState, headers: Headers): EnrollmentUser {
    const jar = cookies(headers),
      cookie = jar.get(challengeName) ?? "",
      factor = jar.get(factorName);
    if (cookie.length > 2048 || !factor)
      throw new HttpError(401, "Sign in again to continue setup");
    const [payload, mac, extra] = cookie.split(".");
    if (
      !payload ||
      !mac ||
      extra ||
      !enrollmentEqual(mac, enrollmentMac(config!.secret, "challenge", payload))
    )
      throw new HttpError(401, "Sign in again to continue setup");
    let value: {
      epoch?: string;
      reviewSha256?: string;
      userId?: string;
      nonce?: string;
      factorSha256?: string;
      expiresAt?: number;
    };
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new HttpError(401, "Sign in again to continue setup");
    }
    const user = state.users.find((item) => item.userId === value.userId);
    if (
      !user ||
      value.epoch !== state.epoch ||
      value.reviewSha256 !== state.reviewSha256 ||
      value.nonce !== user.nonce ||
      value.factorSha256 !== enrollmentSha(factor) ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now()
    )
      throw new HttpError(401, "Sign in again to continue setup");
    return user;
  }
  async function signedIn(state: EnrollmentState, headers: Headers): Promise<EnrollmentUser> {
    const identity = await auth.api.getSession({ headers });
    const user = state.users.find(
      (item) => item.userId === identity?.user.id && item.email === identity.user.email,
    );
    if (
      !user ||
      !["password-set", "ready"].includes(user.phase) ||
      !identity?.user.emailVerified ||
      (await passwordProof(user)) !== user.passwordSha256
    )
      throw new HttpError(401, "Sign in to your reviewed recovery account");
    return user;
  }
  async function signIn(
    request: Request,
    state: EnrollmentState,
    user: EnrollmentUser,
    newPassword: string,
  ): Promise<Response> {
    const result = await auth.api.signInEmail({
      body: { email: user.email, password: newPassword, rememberMe: false },
      headers: request.headers,
      asResponse: true,
    });
    if (!result.ok) throw new HttpError(401, "Check your recovery email and new password");
    const value = (await result.clone().json()) as { twoFactorRedirect?: boolean };
    const response = responseWithCookies(
      {
        challengeRequired: !!value.twoFactorRedirect,
        reopeningAllowed: false,
      } satisfies RecoveryEnrollmentAuthentication,
      result,
    );
    if (value.twoFactorRedirect) {
      const factor = cookies(sessionHeaders(request, result)).get(factorName);
      if (!factor) throw new HttpError(409, "Authenticator sign-in could not start");
      response.headers.append("set-cookie", challengeCookie(state, user, factor));
      response.headers.append(
        "set-cookie",
        `chargeos-recovery.session_token=; ${cookieAttributes}; Max-Age=0`,
      );
    } else {
      const owner = await signedIn(state, sessionHeaders(request, result));
      if (owner.userId !== user.userId)
        throw new HttpError(401, "Sign in to the intended recovery account");
      response.headers.append("set-cookie", expireChallenge);
    }
    return response;
  }
  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname;
    if (
      url.search ||
      ![
        `${root}/info`,
        `${root}/status`,
        `${root}/start`,
        `${root}/sign-in`,
        `${root}/authenticator`,
        `${root}/verify`,
        `${root}/sign-out`,
      ].includes(path)
    )
      throw new HttpError(404, "Recovery setup route not found");
    if (
      (request.method === "GET") !==
        ["info", "status"].some((part) => path === `${root}/${part}`) ||
      !["GET", "POST"].includes(request.method)
    )
      throw new HttpError(405, "Use the recovery setup form");
    if (request.headers.get("origin") && request.headers.get("origin") !== config!.origin)
      throw new HttpError(403, "Use the configured recovery address");
    if (
      request.method === "POST" &&
      (request.headers.get("origin") !== config!.origin ||
        !request.headers.get("content-type")?.startsWith("application/json"))
    )
      throw new HttpError(403, "Use the configured recovery setup form");
    // Reject ambiguity before the auth library can consume a different factor
    // cookie than the wrapper bound into its selected-user challenge.
    cookies(request.headers);
    await budget(request);
    if (request.method === "POST" && !path.endsWith("/sign-out"))
      await budget(request, path.slice(root.length + 1), 5);
    const review = await evaluateNativeRecoveryReview(directory, manifestFile),
      loaded = await readEnrollmentState(directory, config!.secret),
      state = loaded.state;
    bindEnrollment(state, review, config!.origin);
    if (state.epoch !== initial.state.epoch)
      throw new HttpError(409, "Your setup was replaced. Ask for the latest private link");
    async function save() {
      try {
        loaded.serialized = await persistEnrollmentState(
          directory,
          config!.secret,
          state,
          loaded.serialized,
        );
      } catch {
        failed = true;
        throw new HttpError(503, "Setup storage needs an administrator check before continuing");
      }
    }
    if (path === `${root}/info`)
      return json({
        mode: "recovery-enrollment",
        expiresAt: state.expiresAt,
        reopeningAllowed: false,
      });
    if (path === `${root}/start`) {
      const values = await body(request, ["token", "newPassword"]),
        nextPassword = password(values.newPassword);
      if (typeof values.token !== "string" || !/^[a-f0-9]{64}$/.test(values.token))
        throw new HttpError(400, "Open your private setup link again");
      const verifier = enrollmentTokenHash(state, values.token),
        user = state.users.find(
          (item) =>
            item.phase === "issued" &&
            item.tokenSha256 &&
            enrollmentEqual(item.tokenSha256, verifier),
        );
      if (!user)
        throw new HttpError(
          401,
          "This setup link is expired, replaced or already used. Sign in or ask your administrator for a new link",
        );
      if (
        (await database
          .prepare("SELECT count(*) AS total FROM account WHERE user_id=?")
          .bind(user.userId)
          .first<number>("total")) !== 0
      )
        throw new HttpError(409, "Your setup needs reviewed reissue by the administrator");
      user.phase = "claimed";
      user.tokenSha256 = null;
      await save();
      try {
        const hashed = await hashPassword(nextPassword),
          now = Date.now();
        await database.batch([
          database
            .prepare(
              "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)",
            )
            .bind(randomUUID(), user.userId, user.userId, hashed, now, now),
          database
            .prepare(
              "UPDATE user SET email_verified=1,two_factor_enabled=0,updated_at=? WHERE id=? AND email=?",
            )
            .bind(now, user.userId, user.email),
        ]);
        user.passwordSha256 = await passwordProof(user);
        user.phase = "password-set";
        await save();
        return await signIn(request, state, user, nextPassword);
      } catch (error) {
        user.phase = "failed";
        await save();
        throw error;
      }
    }
    if (path === `${root}/sign-in`) {
      const values = await body(request, ["email", "password"]),
        user = state.users.find(
          (item) => item.email === values.email && ["password-set", "ready"].includes(item.phase),
        );
      if (!user || (await passwordProof(user)) !== user.passwordSha256)
        throw new HttpError(401, "Use your reviewed recovery email and new password");
      return signIn(request, state, user, password(values.password));
    }
    if (path === `${root}/verify`) {
      const values = await body(request, ["code"]);
      if (typeof values.code !== "string" || !/^\d{6}$/.test(values.code))
        throw new HttpError(400, "Enter the six-digit code from your new authenticator");
      const identity = await auth.api.getSession({ headers: request.headers }),
        user = identity
          ? await signedIn(state, request.headers)
          : challengeUser(state, request.headers);
      if (
        !user.totpSha256 ||
        (await totpProof(user)) !== user.totpSha256 ||
        !["password-set", "ready"].includes(user.phase)
      )
        throw new HttpError(409, "Start your reviewed authenticator setup first");
      const result = await auth.api.verifyTOTP({
        body: { code: values.code, trustDevice: false },
        headers: request.headers,
        asResponse: true,
      });
      if (!result.ok)
        throw new HttpError(401, "That authenticator code did not work. Try the current code");
      const owner = await signedIn(state, sessionHeaders(request, result));
      if (owner.userId !== user.userId)
        throw new HttpError(401, "Use the authenticator for the intended recovery account");
      user.readySha256 = await readyProof(state, user);
      user.phase = "ready";
      user.verifiedAt = new Date().toISOString();
      await save();
      const response = responseWithCookies({ verified: true, reopeningAllowed: false }, result);
      response.headers.append("set-cookie", expireChallenge);
      return response;
    }
    const user = await signedIn(state, request.headers);
    if (path === `${root}/status`) {
      if (user.phase === "ready" && (await readyProof(state, user)) !== user.readySha256)
        throw new HttpError(409, "Your verified setup changed. Ask for a new private link");
      const identity = await auth.api.getSession({ headers: request.headers });
      return json({
        mode: "recovery-enrollment",
        user: { name: identity!.user.name, email: user.email },
        phase:
          user.phase === "ready"
            ? "ready"
            : user.totpSha256
              ? "verify-authenticator"
              : "set-authenticator",
        expiresAt: state.expiresAt,
        reopeningAllowed: false,
      } satisfies RecoveryEnrollmentStatus);
    }
    if (path === `${root}/sign-out`) {
      await body(request, []);
      const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
      const response = responseWithCookies({ signedOut: true }, result);
      response.headers.append("set-cookie", expireChallenge);
      return response;
    }
    const values = await body(request, ["password"]);
    if (
      user.phase !== "password-set" ||
      user.totpSha256 ||
      (await database
        .prepare("SELECT count(*) AS total FROM two_factor WHERE user_id=?")
        .bind(user.userId)
        .first<number>("total")) !== 0
    )
      throw new HttpError(
        409,
        "Authenticator setup has already started. Use its current code or ask for a new link",
      );
    const result = await auth.api.enableTwoFactor({
      body: { password: password(values.password), method: "totp" },
      headers: request.headers,
      asResponse: true,
    });
    if (!result.ok)
      throw new HttpError(401, "Confirm your new recovery password to set up an authenticator");
    const setup = (await result.json()) as RecoveryEnrollmentAuthenticator;
    if (
      typeof setup.totpURI !== "string" ||
      !Array.isArray(setup.backupCodes) ||
      !setup.backupCodes.every((code) => typeof code === "string")
    )
      throw new HttpError(503, "Authenticator setup could not be completed safely");
    user.totpSha256 = await totpProof(user);
    await save();
    return responseWithCookies(
      {
        totpURI: setup.totpURI,
        backupCodes: setup.backupCodes,
      } satisfies RecoveryEnrollmentAuthenticator,
      result,
    );
  }
  return {
    database,
    handler: {
      async fetch(request: Request): Promise<Response> {
        if (busy)
          return secure(
            json({ error: "Another setup request is finishing. Try again in a moment" }, 429),
          );
        if (failed)
          return secure(json({ error: "Setup is paused for an administrator storage check" }, 503));
        busy = true;
        let response: Response;
        try {
          response = await route(request);
        } catch (error) {
          response =
            error instanceof HttpError
              ? json({ error: error.message }, error.status)
              : json(
                  {
                    error:
                      "Recovery setup is unavailable. Ask your administrator to check the review and private setup state",
                  },
                  503,
                );
        } finally {
          busy = false;
        }
        return secure(response);
      },
    },
    close: () => database.close(),
  };
}
