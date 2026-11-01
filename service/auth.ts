import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema.js";

export interface ServiceEnv {
  SERVICE_DB: D1Database;
  SERVICE_MODE?: string;
  SERVICE_ORIGIN?: string;
  SERVICE_AUTH_SECRET?: string;
}

export function localConfiguration(
  env: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
): { origin: string; secret: string } | null {
  if (
    env.SERVICE_MODE !== "local" ||
    !env.SERVICE_ORIGIN ||
    !env.SERVICE_AUTH_SECRET ||
    env.SERVICE_AUTH_SECRET.length < 32
  )
    return null;
  try {
    const url = new URL(env.SERVICE_ORIGIN);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.origin !== env.SERVICE_ORIGIN
    )
      return null;
    return { origin: url.origin, secret: env.SERVICE_AUTH_SECRET };
  } catch {
    return null;
  }
}

export async function enqueueLocalDelivery(
  env: ServiceEnv,
  kind: "verify-email" | "reset-password" | "invitation",
  recipient: string,
  url: string,
  expiresAt: Date,
): Promise<void> {
  if (!localConfiguration(env)) throw new Error("Local delivery is unavailable");
  const db = drizzle(env.SERVICE_DB);
  await db
    .insert(schema.localOutbox)
    .values({ id: crypto.randomUUID(), kind, recipient, url, createdAt: new Date(), expiresAt });
}

export function createServiceAuth(env: ServiceEnv) {
  const config = localConfiguration(env);
  if (!config) throw new Error("Commercial service is not configured for local development");
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
        await enqueueLocalDelivery(
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
        await enqueueLocalDelivery(
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
      cookiePrefix: "chargeos-service",
      useSecureCookies: false,
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
