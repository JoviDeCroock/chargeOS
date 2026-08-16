export const DELEGATE_ROLES = ["installer", "employer", "energy-provider"] as const;

export type DelegateRole = (typeof DELEGATE_ROLES)[number];

export const DELEGATE_SCOPES = [
  "station-status:read",
  "diagnostics:read",
  "sessions:read",
  "freedom-test:read",
  "migration:read",
] as const;

export type DelegateScope = (typeof DELEGATE_SCOPES)[number];

export const ROLE_SCOPES: Readonly<Record<DelegateRole, readonly DelegateScope[]>> = {
  installer: ["station-status:read", "diagnostics:read", "freedom-test:read", "migration:read"],
  employer: ["sessions:read"],
  "energy-provider": ["station-status:read"],
};

export interface DelegateGrantInput {
  readonly expiresAt: string;
  readonly role: DelegateRole;
  readonly scopes?: readonly DelegateScope[];
}

export interface DelegateGrantSummary {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly grantId: string;
  readonly revokedAt: string | null;
  readonly role: DelegateRole;
  readonly scopes: readonly DelegateScope[];
  readonly status: "active" | "expired" | "revoked";
  readonly tokenHint: string;
}

export interface DelegateGrantCreated {
  readonly grant: DelegateGrantSummary;
  /** This bearer secret is returned once and is never persisted. */
  readonly token: string;
}

export interface DelegateStationStatus {
  readonly generatedAt: string;
  readonly station: {
    readonly boot: {
      readonly firmwareVersion: string | null;
      readonly model: string;
      readonly vendor: string;
    } | null;
    readonly connected: boolean;
    readonly connectedAt: string | null;
    readonly connectors: readonly {
      readonly connectorId: number;
      readonly errorCode: string;
      readonly status: string;
      readonly updatedAt: string;
    }[];
    readonly id: string;
  };
}

export interface DelegateDiagnostics extends DelegateStationStatus {
  readonly authorization: {
    readonly lastSyncAt: string | null;
    readonly lastSyncRevision: number | null;
    readonly lastSyncStatus: string | null;
  };
  readonly readiness: import("./contracts.js").CapabilityAssessment | null;
  readonly recentEvents: readonly {
    readonly at: string;
    readonly direction: "station-to-csms" | "csms-to-station" | "system";
    readonly eventId: string;
    readonly message: string;
  }[];
}

export interface DelegateSessionExport {
  readonly exportedAt: string;
  readonly schemaVersion: 1;
  readonly sessions: readonly Omit<import("./contracts.js").ChargeSession, "tagPseudonym">[];
  readonly stationId: string;
}
