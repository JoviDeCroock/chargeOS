import { describe, expect, it } from "vitest";

import {
  authenticateDelegate,
  createDelegateGrant,
  DelegationInputError,
  projectDelegateGrants,
  revokeDelegateGrant,
} from "../server/delegation.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  async allocateAuthorizationRevision(): Promise<number> {
    return 1;
  }
  async recordTransactionStart(): Promise<{ replayed: boolean; transactionId: number }> {
    return { replayed: false, transactionId: 1 };
  }
  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }
  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

describe("delegate capability authority", () => {
  it("returns a one-time secret, stores only its hash, expires, and revokes fail closed", async () => {
    const evidence = new MemoryEvidenceStore();
    const now = new Date("2026-08-14T12:00:00.000Z");
    const created = await createDelegateGrant(
      "STATION_1",
      evidence,
      {
        expiresAt: "2026-08-15T12:00:00.000Z",
        role: "installer",
        scopes: ["diagnostics:read"],
      },
      now,
    );

    expect(created.token).toMatch(/^chgdel\./);
    expect(JSON.stringify(evidence.events)).not.toContain(created.token);
    expect(JSON.stringify(evidence.events)).toContain("tokenHash");
    expect(authenticateDelegate(evidence.events, "STATION_1", created.token, now)).toMatchObject({
      grantId: created.grant.grantId,
      role: "installer",
      scopes: ["diagnostics:read"],
    });
    expect(authenticateDelegate(evidence.events, "STATION_1", `${created.token}x`, now)).toBeNull();
    expect(authenticateDelegate(evidence.events, "OTHER_STATION", created.token, now)).toBeNull();
    const malformedExpiry = evidence.events.map((event) =>
      event.message === "DelegateCapabilityGranted"
        ? {
            ...event,
            payload: { ...(event.payload as Record<string, unknown>), expiresAt: "not-a-date" },
          }
        : event,
    );
    expect(authenticateDelegate(malformedExpiry, "STATION_1", created.token, now)).toBeNull();
    expect(
      authenticateDelegate(
        evidence.events,
        "STATION_1",
        created.token,
        new Date("2026-08-15T12:00:00.000Z"),
      ),
    ).toBeNull();

    await revokeDelegateGrant("STATION_1", evidence, created.grant.grantId, now);
    expect(authenticateDelegate(evidence.events, "STATION_1", created.token, now)).toBeNull();
    expect(projectDelegateGrants(evidence.events, now)[0]).toMatchObject({
      revokedAt: now.toISOString(),
      status: "revoked",
    });
  });

  it("rejects over-broad role scopes and unbounded lifetimes", async () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const evidence = new MemoryEvidenceStore();
    await expect(
      createDelegateGrant(
        "STATION_1",
        evidence,
        {
          expiresAt: "2026-08-15T12:00:00.000Z",
          role: "employer",
          scopes: ["diagnostics:read"],
        },
        now,
      ),
    ).rejects.toBeInstanceOf(DelegationInputError);
    await expect(
      createDelegateGrant(
        "STATION_1",
        evidence,
        { expiresAt: "2027-08-14T12:00:00.000Z", role: "installer" },
        now,
      ),
    ).rejects.toThrow("within 90 days");
  });
});
