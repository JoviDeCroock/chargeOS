import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema.js";

import { serviceConfiguration, signupDelivery, type ServiceSettings } from "./configuration.js";
import { deliveryAdmission } from "./delivery.js";
export { localConfiguration, serviceConfiguration } from "./configuration.js";
export interface ServiceEnv extends ServiceSettings {
  SERVICE_DB: D1Database;
  [signupDelivery]?: { id: string; recipient: string };
}

export async function enqueueServiceDelivery(
  env: ServiceEnv,
  kind: "verify-email" | "reset-password" | "invitation",
  recipient: string,
  url: string,
  expiresAt: Date,
): Promise<void> {
  const config = serviceConfiguration(env);
  if (!config) throw new Error("Service delivery is unavailable");
  const now = Date.now();
  const reservation = env[signupDelivery];
  if (config.mode === "self-hosted" && kind === "verify-email" && reservation) {
    if (reservation.recipient !== recipient.toLowerCase())
      throw new Error("Signup delivery identity changed");
    const result = await env.SERVICE_DB.prepare(
      "UPDATE local_outbox SET url=?,expires_at=?,next_attempt_at=0 WHERE id=? AND recipient=? AND kind='verify-email' AND channel='smtp' AND status='pending' AND attempts=0 AND url='' AND expires_at>?",
    )
      .bind(url, expiresAt.getTime(), reservation.id, reservation.recipient, now)
      .run();
    if (result.meta.changes !== 1) throw new Error("Signup delivery reservation is unavailable");
    return;
  }
  const admission = await deliveryAdmission(env, kind, recipient, now);
  await env.SERVICE_DB.batch([
    ...admission.before,
    env.SERVICE_DB.prepare(
      `INSERT INTO local_outbox(id,kind,recipient,url,created_at,expires_at,channel) SELECT ?,?,?,?,?,?,? WHERE ${admission.condition}`,
    ).bind(
      crypto.randomUUID(),
      kind,
      recipient,
      url,
      now,
      expiresAt.getTime(),
      config.delivery,
      ...admission.bindings,
    ),
  ]);
}

export function createServiceAuth(
  env: ServiceEnv,
  purpose: "normal" | "recovery-enrollment" = "normal",
) {
  const config = serviceConfiguration(env);
  if (!config || (purpose === "recovery-enrollment" && config.mode !== "local-development"))
    throw new Error("Commercial authentication is not configured for this runtime");
  return betterAuth({
    appName: "chargeOS",
    telemetry: { enabled: false },
    baseURL: config.origin,
    basePath: "/service/api/auth",
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(drizzle(env.SERVICE_DB), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await enqueueServiceDelivery(
          env,
          "reset-password",
          user.email,
          url,
          new Date(Date.now() + 3_600_000),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueServiceDelivery(
          env,
          "verify-email",
          user.email,
          url,
          new Date(Date.now() + 3_600_000),
        );
      },
    },
    session: { expiresIn: 604800, updateAge: 86400, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: purpose === "recovery-enrollment" ? "chargeos-recovery" : "chargeos-service",
      useSecureCookies: config.mode === "self-hosted",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/service/api" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    plugins: [twoFactor({ issuer: "chargeOS", skipVerificationOnEnable: false })],
  });
}
