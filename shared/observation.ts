export interface ObservationSource {
  readonly sha256: string;
  readonly format: "csv";
  readonly label: string;
}

export interface ObservationCsv {
  readonly headers: readonly string[];
  readonly delimiter: "," | ";";
  readonly rows: readonly { readonly recordNumber: number; readonly cells: readonly string[] }[];
}

export interface SessionColumnMapping {
  readonly sessionId: string;
  readonly stationId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly energy: string;
  readonly driverAlias: string | null;
  readonly energyUnit: "kWh" | "Wh";
  readonly decimalSeparator: "." | ",";
}

export interface ObservationSession {
  readonly sessionId: string;
  readonly stationId: string;
  readonly driverAlias: string;
  readonly driverAssignment: "mapped-alias" | "declared-for-import";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly energyWh: number;
  readonly sourceSha256: string;
  readonly sourceRecord: number;
}

export interface ObservationImport {
  readonly source: ObservationSource;
  readonly mapping: SessionColumnMapping;
  readonly declaredDriverAlias: string | null;
  readonly sessions: readonly ObservationSession[];
  readonly issues: readonly {
    readonly sourceSha256: string;
    readonly sourceRecord: number;
    readonly code: string;
    readonly message: string;
  }[];
}

export interface ObservationPolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly driverAlias: string;
  readonly stationId: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly rateEurPerKwh: string;
}

export interface ObservationPolicy extends ObservationPolicyInput {
  readonly currency: "EUR";
  readonly rateMicroEurPerKwh: number;
  readonly rounding: "per-session-half-up-to-cent";
}

export interface ObservationDecision {
  readonly session: ObservationSession;
  readonly status: "included" | "held" | "duplicate" | "excluded";
  readonly reason: string;
  readonly amountCents: number;
}

export interface ReimbursementObservation {
  readonly schemaVersion: 1;
  readonly kind: "reimbursement-observation";
  readonly authority: "unapproved-local-analysis";
  readonly policy: ObservationPolicy;
  readonly sources: readonly ObservationSource[];
  readonly sourceMappings: readonly {
    readonly sha256: string;
    readonly mapping: SessionColumnMapping;
    readonly declaredDriverAlias: string | null;
  }[];
  readonly decisions: readonly ObservationDecision[];
  readonly issues: ObservationImport["issues"];
  readonly includedEnergyWh: number;
  readonly expectedAmountCents: number;
  readonly counts: Readonly<Record<ObservationDecision["status"], number>>;
}

export interface DeclaredAmountComparison {
  readonly authority: "user-declared-amount-only";
  readonly reportedAmountCents: number;
  readonly differenceCents: number;
  readonly outcome:
    | "matches-declared-amount"
    | "matches-known-amount-with-unresolved-records"
    | "difference-to-investigate";
}
