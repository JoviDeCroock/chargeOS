import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  DELEGATE_ROLES,
  DELEGATE_SCOPES,
  ROLE_SCOPES,
  type DelegateGrantCreated,
  type DelegateGrantInput,
  type DelegateGrantSummary,
  type DelegateRole,
  type DelegateScope,
} from "../shared/delegation.js";
import type { EvidenceEvent, EvidenceStore } from "./events.js";
import { evidenceEvent } from "./events.js";

const MINIMUM_LIFETIME_MS = 5 * 60 * 1000;
const MAXIMUM_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

interface StoredDelegateGrant {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly grantId: string;
  readonly role: DelegateRole;
  readonly scopes: readonly DelegateScope[];
  readonly tokenHash: string;
  readonly tokenHint: string;
}

export interface DelegatePrincipal {
  readonly expiresAt: string;
  readonly grantId: string;
  readonly role: DelegateRole;
  readonly scopes: readonly DelegateScope[];
}

export class DelegationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationInputError";
  }
}

export class DelegationNotFoundError extends Error {
  constructor() {
    super("Delegate grant not found");
    this.name = "DelegationNotFoundError";
  }
}

export class DelegationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationConflictError";
  }
}

export async function createDelegateGrant(
  stationId: string,
  evidence: EvidenceStore,
  input: DelegateGrantInput,
  now = new Date(),
): Promise<DelegateGrantCreated> {
  const role = validateRole(input.role);
  const scopes = validateScopes(role, input.scopes);
  const expiresAt = validateExpiry(input.expiresAt, now);
  const grantId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `chgdel.${grantId}.${secret}`;
  const createdAt = now.toISOString();
  const tokenHint = `…${secret.slice(-6)}`;

  await evidence.append(
    evidenceEvent(stationId, "system", "DelegateCapabilityGranted", {
      createdAt,
      expiresAt,
      grantId,
      role,
      scopes,
      tokenHash: hashToken(token),
      tokenHint,
    } satisfies StoredDelegateGrant),
  );

  return {
    grant: {
      createdAt,
      expiresAt,
      grantId,
      revokedAt: null,
      role,
      scopes,
      status: "active",
      tokenHint,
    },
    token,
  };
}

export async function revokeDelegateGrant(
  stationId: string,
  evidence: EvidenceStore,
  grantId: string,
  now = new Date(),
): Promise<DelegateGrantSummary> {
  if (!isGrantId(grantId)) throw new DelegationNotFoundError();
  const events = await evidence.readEvents();
  const current = projectDelegateGrants(
    events.filter((event) => event.stationId === stationId),
    now,
  ).find((grant) => grant.grantId === grantId);
  if (!current) throw new DelegationNotFoundError();
  if (current.status === "revoked") {
    throw new DelegationConflictError("Delegate grant is already revoked");
  }
  await evidence.append(
    evidenceEvent(stationId, "system", "DelegateCapabilityRevoked", {
      grantId,
      revokedAt: now.toISOString(),
    }),
  );
  return { ...current, revokedAt: now.toISOString(), status: "revoked" };
}

export function authenticateDelegate(
  events: readonly EvidenceEvent[],
  stationId: string,
  token: string,
  now = new Date(),
): DelegatePrincipal | null {
  const grantId = parseGrantId(token);
  if (!grantId) return null;
  const event = events.findLast(
    (candidate) =>
      candidate.message === "DelegateCapabilityGranted" &&
      candidate.stationId === stationId &&
      record(candidate.payload).grantId === grantId,
  );
  const stored = parseStoredGrant(event?.payload);
  if (!stored || !safeHashEqual(stored.tokenHash, hashToken(token))) return null;
  const revoked = events.some(
    (candidate) =>
      candidate.message === "DelegateCapabilityRevoked" &&
      candidate.stationId === stationId &&
      record(candidate.payload).grantId === grantId,
  );
  if (revoked || Date.parse(stored.expiresAt) <= now.getTime()) return null;
  return {
    expiresAt: stored.expiresAt,
    grantId: stored.grantId,
    role: stored.role,
    scopes: stored.scopes,
  };
}

export function projectDelegateGrants(
  events: readonly EvidenceEvent[],
  now = new Date(),
): readonly DelegateGrantSummary[] {
  const grants = new Map<string, StoredDelegateGrant>();
  const revocations = new Map<string, string>();
  for (const event of events) {
    if (event.message === "DelegateCapabilityGranted") {
      const grant = parseStoredGrant(event.payload);
      if (grant) grants.set(grant.grantId, grant);
    }
    if (event.message === "DelegateCapabilityRevoked") {
      const payload = record(event.payload);
      if (typeof payload.grantId === "string" && typeof payload.revokedAt === "string") {
        revocations.set(payload.grantId, payload.revokedAt);
      }
    }
  }
  return [...grants.values()]
    .map((grant): DelegateGrantSummary => {
      const revokedAt = revocations.get(grant.grantId) ?? null;
      return {
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
        grantId: grant.grantId,
        revokedAt,
        role: grant.role,
        scopes: grant.scopes,
        status:
          revokedAt !== null
            ? "revoked"
            : Date.parse(grant.expiresAt) <= now.getTime()
              ? "expired"
              : "active",
        tokenHint: grant.tokenHint,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function hasDelegateScope(principal: DelegatePrincipal, scope: DelegateScope): boolean {
  return principal.scopes.includes(scope);
}

export async function recordDelegateUse(
  stationId: string,
  evidence: EvidenceStore,
  principal: DelegatePrincipal,
  scope: DelegateScope,
  route: string,
): Promise<void> {
  await evidence.append(
    evidenceEvent(stationId, "system", "DelegateCapabilityUsed", {
      grantId: principal.grantId,
      role: principal.role,
      route,
      scope,
    }),
  );
}

function validateRole(value: unknown): DelegateRole {
  if (typeof value !== "string" || !DELEGATE_ROLES.includes(value as DelegateRole)) {
    throw new DelegationInputError("role must be installer, employer, or energy-provider");
  }
  return value as DelegateRole;
}

function validateScopes(
  role: DelegateRole,
  value: readonly DelegateScope[] | undefined,
): readonly DelegateScope[] {
  const scopes = value ?? ROLE_SCOPES[role];
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new DelegationInputError("scopes must contain at least one capability");
  }
  const unique = [...new Set(scopes)];
  const allowed = ROLE_SCOPES[role];
  if (
    unique.length !== scopes.length ||
    unique.some(
      (scope) =>
        typeof scope !== "string" ||
        !DELEGATE_SCOPES.includes(scope as DelegateScope) ||
        !allowed.includes(scope as DelegateScope),
    )
  ) {
    throw new DelegationInputError("scopes must be a unique subset allowed for the selected role");
  }
  return unique as DelegateScope[];
}

function validateExpiry(value: unknown, now: Date): string {
  if (typeof value !== "string")
    throw new DelegationInputError("expiresAt must be an ISO timestamp");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new DelegationInputError("expiresAt must be a normalized ISO timestamp");
  }
  const lifetime = timestamp - now.getTime();
  if (lifetime < MINIMUM_LIFETIME_MS) {
    throw new DelegationInputError("delegate grants must remain valid for at least five minutes");
  }
  if (lifetime > MAXIMUM_LIFETIME_MS) {
    throw new DelegationInputError("delegate grants must expire within 90 days");
  }
  return value;
}

function parseStoredGrant(value: unknown): StoredDelegateGrant | null {
  const payload = record(value);
  if (
    typeof payload.createdAt !== "string" ||
    !isNormalizedIso(payload.createdAt) ||
    typeof payload.expiresAt !== "string" ||
    !isNormalizedIso(payload.expiresAt) ||
    typeof payload.grantId !== "string" ||
    !isGrantId(payload.grantId) ||
    typeof payload.role !== "string" ||
    !DELEGATE_ROLES.includes(payload.role as DelegateRole) ||
    !Array.isArray(payload.scopes) ||
    payload.scopes.length === 0 ||
    new Set(payload.scopes).size !== payload.scopes.length ||
    payload.scopes.some(
      (scope) =>
        typeof scope !== "string" ||
        !DELEGATE_SCOPES.includes(scope as DelegateScope) ||
        !ROLE_SCOPES[payload.role as DelegateRole].includes(scope as DelegateScope),
    ) ||
    typeof payload.tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.tokenHash) ||
    typeof payload.tokenHint !== "string" ||
    !/^…[A-Za-z0-9_-]{6}$/.test(payload.tokenHint)
  ) {
    return null;
  }
  return payload as unknown as StoredDelegateGrant;
}

function isNormalizedIso(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** Cheap syntactic check so malformed bearer values never trigger a full ledger read. */
export function delegateGrantIdFromToken(token: string): string | null {
  return parseGrantId(token);
}

function parseGrantId(token: string): string | null {
  const match = token.match(/^chgdel\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/);
  return match && isGrantId(match[1] ?? "") ? (match[1] ?? null) : null;
}

function isGrantId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
