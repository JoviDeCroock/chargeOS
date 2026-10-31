import type {
  ApiErrorResponse,
  AuthorizationSyncResponse,
  CapabilityAssessment,
  ContinuityPreparationInput,
  ContinuityPreparationResult,
  DelegateGrantCreated,
  DelegateGrantInput,
  DelegateGrantSummary,
  FreedomTestDeviceInput,
  FreedomTestObservationInput,
  FreedomTestProjection,
  FreedomTestRunInput,
  FleetSnapshot,
  MigrationAuthorizationInput,
  MigrationObservationInput,
  MigrationProjection,
  OwnerSnapshot,
  OwnerTagAddInput,
  OwnerTagMutationResult,
  OwnerTagRevokeInput,
  TroubleshootingInput,
  TroubleshootingPreview,
  TroubleshootingResult,
} from "../shared/contracts.js";

export class OwnerApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OwnerApiError";
    this.code = code;
    this.status = status;
  }
}

export function fetchTroubleshootingPreview(stationId: string, token: string) {
  return requestJson<TroubleshootingPreview>(
    stationPath(stationId, "/troubleshooting/preview"),
    token,
  );
}

export function askTroubleshooter(stationId: string, token: string, input: TroubleshootingInput) {
  return requestJson<TroubleshootingResult>(stationPath(stationId, "/troubleshooting"), token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchFleet(token: string): Promise<FleetSnapshot> {
  return requestJson<FleetSnapshot>("/api/v1/fleet", token);
}

export async function fetchSnapshot(stationId: string, token: string): Promise<OwnerSnapshot> {
  return requestJson<OwnerSnapshot>(stationPath(stationId, "/snapshot"), token);
}

export async function addOwnerTag(
  stationId: string,
  input: OwnerTagAddInput,
  token: string,
): Promise<OwnerTagMutationResult> {
  return requestJson<OwnerTagMutationResult>(stationPath(stationId, "/owner-tags"), token, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function revokeOwnerTag(
  stationId: string,
  tagPseudonym: string,
  input: OwnerTagRevokeInput,
  token: string,
): Promise<OwnerTagMutationResult> {
  return requestJson<OwnerTagMutationResult>(
    stationPath(stationId, `/owner-tags/${encodeURIComponent(tagPseudonym)}/revoke`),
    token,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function createDelegation(
  stationId: string,
  input: DelegateGrantInput,
  token: string,
): Promise<DelegateGrantCreated> {
  return requestJson<DelegateGrantCreated>(stationPath(stationId, "/delegations"), token, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function revokeDelegation(
  stationId: string,
  grantId: string,
  token: string,
): Promise<DelegateGrantSummary> {
  return requestJson<DelegateGrantSummary>(
    stationPath(stationId, `/delegations/${encodeURIComponent(grantId)}/revoke`),
    token,
    { method: "POST" },
  );
}

export async function saveMigrationCheckpoint(
  stationId: string,
  stepId: string,
  input: MigrationObservationInput,
  token: string,
): Promise<MigrationProjection> {
  return requestJson<MigrationProjection>(
    stationPath(stationId, `/migration/checkpoints/${encodeURIComponent(stepId)}`),
    token,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function authorizeMigration(
  stationId: string,
  input: MigrationAuthorizationInput,
  token: string,
): Promise<MigrationProjection> {
  return requestJson<MigrationProjection>(stationPath(stationId, "/migration/authorize"), token, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function downloadMigrationReport(token: string, stationId: string): Promise<void> {
  await downloadJson(
    stationPath(stationId, "/migration/report"),
    token,
    `chargeos-${safeFilename(stationId)}-migration.json`,
  );
}

export async function inspectStation(
  stationId: string,
  token: string,
): Promise<CapabilityAssessment> {
  return requestJson<CapabilityAssessment>(
    `/api/v1/stations/${encodeURIComponent(stationId)}/inspect`,
    token,
    { method: "POST" },
  );
}

export async function syncAuthorizations(
  stationId: string,
  token: string,
): Promise<AuthorizationSyncResponse> {
  return requestJson<AuthorizationSyncResponse>(
    `/api/v1/stations/${encodeURIComponent(stationId)}/sync-authorizations`,
    token,
    { method: "POST" },
  );
}

export async function prepareOwnerContinuity(
  stationId: string,
  input: ContinuityPreparationInput,
  token: string,
): Promise<ContinuityPreparationResult> {
  return requestJson<ContinuityPreparationResult>(
    `/api/v1/stations/${encodeURIComponent(stationId)}/prepare-owner-continuity`,
    token,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function saveFreedomTestDevice(
  stationId: string,
  input: FreedomTestDeviceInput,
  token: string,
): Promise<FreedomTestProjection> {
  return requestJson<FreedomTestProjection>(stationPath(stationId, "/freedom-test/device"), token, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function saveFreedomTestObservation(
  stationId: string,
  stepId: string,
  input: FreedomTestObservationInput,
  token: string,
): Promise<FreedomTestProjection> {
  return requestJson<FreedomTestProjection>(
    stationPath(stationId, `/freedom-test/observations/${encodeURIComponent(stepId)}`),
    token,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function startFreedomTestRun(
  stationId: string,
  input: FreedomTestRunInput,
  token: string,
): Promise<FreedomTestProjection> {
  return requestJson<FreedomTestProjection>(stationPath(stationId, "/freedom-test/runs"), token, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function downloadFreedomTestReport(token: string, stationId: string): Promise<void> {
  await downloadJson(
    stationPath(stationId, "/freedom-test/report"),
    token,
    `chargeos-${safeFilename(stationId)}-freedom-test.json`,
  );
}

export async function downloadContinuityExport(token: string, stationId: string): Promise<void> {
  await downloadJson(
    stationPath(stationId, "/continuity-export"),
    token,
    `chargeos-${safeFilename(stationId)}-continuity.json`,
  );
}

export async function downloadFieldEvidencePack(token: string, stationId: string): Promise<void> {
  await downloadJson(
    stationPath(stationId, "/field-pack"),
    token,
    `chargeos-${safeFilename(stationId)}-field-pack.json`,
  );
}

async function downloadJson(path: string, token: string, filename: string): Promise<void> {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function requestJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  return (await response.json()) as T;
}

async function apiError(response: Response): Promise<OwnerApiError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return new OwnerApiError(response.status, body.error.code, body.error.message);
  } catch {
    return new OwnerApiError(response.status, "request_failed", "The owner API request failed");
  }
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function stationPath(stationId: string, suffix: string): string {
  return `/api/v1/stations/${encodeURIComponent(stationId)}${suffix}`;
}
