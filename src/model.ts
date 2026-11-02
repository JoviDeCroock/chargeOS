import { computed, signal } from "@preact/signals";

import type {
  DelegateGrantCreated,
  DelegateGrantInput,
  FreedomTestDeviceInput,
  FreedomTestObservationInput,
  FreedomTestRunInput,
  FleetSnapshot,
  MigrationAuthorizationInput,
  MigrationObservationInput,
  OwnerSnapshot,
  OwnerTagAddInput,
  OwnerTagRevokeInput,
  ContinuityPreparationInput,
  StationCommandInput,
  StationCommandRecord,
  UsageReport,
} from "../shared/contracts.js";
import { usageReportCsv } from "../shared/usage.js";
import {
  addOwnerTag,
  authorizeMigration,
  createDelegation,
  downloadContinuityExport,
  downloadFieldEvidencePack,
  downloadFreedomTestReport,
  downloadMigrationReport,
  fetchSnapshot,
  fetchFleet,
  fetchUsageReport,
  downloadText,
  inspectStation,
  OwnerApiError,
  prepareOwnerContinuity,
  saveFreedomTestDevice,
  saveFreedomTestObservation,
  startFreedomTestRun,
  saveMigrationCheckpoint,
  sendStationCommand,
  syncAuthorizations,
  revokeDelegation,
  revokeOwnerTag,
} from "./api.js";

export const ownerToken = signal(sessionStorage.getItem("chargeos.ownerToken") ?? "");
export const fleet = signal<FleetSnapshot | null>(null);
export const selectedStationId = signal(sessionStorage.getItem("chargeos.selectedStationId") ?? "");
export const snapshot = signal<OwnerSnapshot | null>(null);
export const loading = signal(false);
export const action = signal<
  | "inspect"
  | "prepare"
  | "sync"
  | "export"
  | "freedom-device"
  | "freedom-step"
  | "freedom-run"
  | "freedom-export"
  | "field-pack-export"
  | "delegate-issue"
  | "delegate-revoke"
  | "migration-step"
  | "migration-authorize"
  | "migration-export"
  | "owner-tag-add"
  | "owner-tag-revoke"
  | "station-command"
  | null
>(null);
export const notice = signal<{ kind: "error" | "success"; message: string } | null>(null);
export const issuedDelegate = signal<DelegateGrantCreated | null>(null);
export const usageReport = signal<UsageReport | null>(null);
export const usageLoading = signal(false);

/** The browser's IANA time zone; usage months follow the person reading the report. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
export const isAuthenticated = computed(() => ownerToken.value.length > 0);

export function setOwnerToken(value: string): void {
  const token = value.trim();
  ownerToken.value = token;
  snapshot.value = null;
  fleet.value = null;
  notice.value = null;
  issuedDelegate.value = null;
  usageReport.value = null;
  if (token) {
    sessionStorage.setItem("chargeos.ownerToken", token);
  } else {
    sessionStorage.removeItem("chargeos.ownerToken");
  }
}

export function selectStation(stationId: string): void {
  if (!fleet.value?.stations.some(({ id }) => id === stationId)) return;
  selectedStationId.value = stationId;
  snapshot.value = null;
  sessionStorage.setItem("chargeos.selectedStationId", stationId);
}

export async function runDelegateIssue(input: DelegateGrantInput): Promise<void> {
  if (!ownerToken.value) return;
  action.value = "delegate-issue";
  issuedDelegate.value = null;
  try {
    const current = snapshot.value;
    if (!current) return;
    issuedDelegate.value = await createDelegation(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message: "Expiring delegate capability issued. Copy the bearer secret now; it is not stored.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runDelegateRevoke(grantId: string): Promise<void> {
  if (!ownerToken.value) return;
  action.value = "delegate-revoke";
  try {
    const current = snapshot.value;
    if (!current) return;
    await revokeDelegation(current.station.id, grantId, ownerToken.value);
    if (issuedDelegate.value?.grant.grantId === grantId) issuedDelegate.value = null;
    notice.value = {
      kind: "success",
      message: "Delegate capability revoked without changing owner authority or local charging.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runMigrationCheckpointSave(
  stepId: string,
  input: MigrationObservationInput,
): Promise<void> {
  if (!ownerToken.value) return;
  action.value = "migration-step";
  try {
    const current = snapshot.value;
    if (!current) return;
    await saveMigrationCheckpoint(current.station.id, stepId, input, ownerToken.value);
    notice.value = {
      kind: input.outcome === "confirmed" ? "success" : "error",
      message:
        input.outcome === "confirmed"
          ? "Migration checkpoint confirmed with an external evidence hash."
          : "Migration stop condition recorded. Do not change the charger endpoint.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runMigrationAuthorization(input: MigrationAuthorizationInput): Promise<void> {
  if (!ownerToken.value) return;
  action.value = "migration-authorize";
  try {
    const current = snapshot.value;
    if (!current) return;
    await authorizeMigration(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message:
        "The canonical target matched the dossier. Its hash and a time-bounded owner authorization were recorded; physical work still requires the documented installer safety plan.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runMigrationReportExport(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "migration-export";
  try {
    await downloadMigrationReport(ownerToken.value, current.station.id);
    notice.value = {
      kind: "success",
      message: "Unreviewed migration dossier exported with its evidence-chain anchor.",
    };
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function refreshSnapshot(clearNotice = true): Promise<void> {
  if (!ownerToken.value || !selectedStationId.value) return;
  loading.value = true;
  try {
    snapshot.value = await fetchSnapshot(selectedStationId.value, ownerToken.value);
    fleet.value = await fetchFleet(ownerToken.value);
    if (clearNotice) notice.value = null;
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
  }
}

export async function refreshFleet(clearNotice = true): Promise<void> {
  if (!ownerToken.value) return;
  loading.value = true;
  try {
    const nextFleet = await fetchFleet(ownerToken.value);
    fleet.value = nextFleet;
    const stored = selectedStationId.value;
    const selected = nextFleet.stations.some(({ id }) => id === stored)
      ? stored
      : (nextFleet.stations[0]?.id ?? "");
    selectedStationId.value = selected;
    if (selected) {
      sessionStorage.setItem("chargeos.selectedStationId", selected);
      snapshot.value = await fetchSnapshot(selected, ownerToken.value);
    }
    if (clearNotice) notice.value = null;
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
  }
}

export async function refreshUsage(month: string): Promise<void> {
  if (!ownerToken.value) return;
  usageLoading.value = true;
  try {
    usageReport.value = await fetchUsageReport(month, browserTimeZone(), ownerToken.value);
  } catch (error) {
    handleError(error);
  } finally {
    usageLoading.value = false;
  }
}

export function downloadUsageCsv(report: UsageReport): void {
  downloadText(usageReportCsv(report), `chargeos-usage-${report.month}.csv`, "text/csv");
}

export async function runInspection(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "inspect";
  try {
    const result = await inspectStation(current.station.id, ownerToken.value);
    notice.value = {
      kind: result.state === "ready" ? "success" : "error",
      message:
        result.state === "ready"
          ? "All software-verifiable offline prerequisites passed. A physical Freedom Test is still required."
          : "The charger did not prove every required offline capability.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runContinuityPreparation(input: ContinuityPreparationInput): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "prepare";
  try {
    const result = await prepareOwnerContinuity(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message: result.changes.length
        ? `${result.changes.length} owner-continuity settings were accepted and re-inspected. Synchronize owner tags next.`
        : "Owner-continuity settings were already safe. Synchronize owner tags next.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
    await refreshSnapshot(false);
  } finally {
    action.value = null;
  }
}

export async function runStationCommand(input: StationCommandInput): Promise<boolean> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return false;
  action.value = "station-command";
  try {
    const { command } = await sendStationCommand(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: command.state === "accepted" ? "success" : "error",
      message: stationCommandMessage(command),
    };
    await refreshSnapshot(false);
    if (command.state === "accepted") {
      // Observed outcomes arrive in later charger messages; look again once they are likely in.
      setTimeout(() => void refreshSnapshot(false), 4_000);
    }
    return command.state === "accepted";
  } catch (error) {
    handleError(error);
    await refreshSnapshot(false);
    return false;
  } finally {
    action.value = null;
  }
}

export function stationCommandMessage(command: StationCommandRecord): string {
  const name = STATION_COMMAND_LABELS[command.type];
  switch (command.state) {
    case "accepted":
      return `${name}: the charger accepted the command. Watch the observed result below; acceptance alone does not prove it happened.`;
    case "rejected":
      return `${name}: the charger refused (${command.status ?? "no reason"}). Nothing changed.`;
    case "failed":
      return `${name}: not carried out (${command.status ?? "unknown error"}). This charger may not support it.`;
    case "uncertain":
      return `${name}: no clear answer (${command.status ?? "unknown"}). The charger may or may not have acted; check its state before trying again.`;
    case "pending":
      return `${name}: sent, waiting for the charger.`;
  }
}

export const STATION_COMMAND_LABELS: Readonly<Record<StationCommandRecord["type"], string>> = {
  ChangeAvailability: "Make available",
  RemoteStartTransaction: "Remote start",
  RemoteStopTransaction: "Remote stop",
  Reset: "Restart",
  UnlockConnector: "Unlock connector",
};

export async function runAuthorizationSync(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "sync";
  try {
    const result = await syncAuthorizations(current.station.id, ownerToken.value);
    notice.value = {
      kind: "success",
      message: `Owner authorization list revision ${result.listVersion} was accepted by the charger.`,
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
    await refreshSnapshot(false);
  } finally {
    action.value = null;
  }
}

export async function runOwnerTagAdd(input: OwnerTagAddInput): Promise<void> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return;
  action.value = "owner-tag-add";
  try {
    await addOwnerTag(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message:
        "Owner tag added to durable desired state. It remains pending until the charger accepts a complete synchronization.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runOwnerTagRevoke(
  tagPseudonym: string,
  input: OwnerTagRevokeInput,
): Promise<void> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return;
  action.value = "owner-tag-revoke";
  try {
    await revokeOwnerTag(current.station.id, tagPseudonym, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message:
        "Owner tag removed from durable desired state. It may still authorize locally until the charger accepts the replacement list.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runContinuityExport(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "export";
  try {
    await downloadContinuityExport(ownerToken.value, current.station.id);
    notice.value = {
      kind: "success",
      message:
        "Redacted continuity evidence exported. Secrets and raw RFID values are intentionally excluded.",
    };
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runFieldPackExport(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "field-pack-export";
  try {
    await downloadFieldEvidencePack(ownerToken.value, current.station.id);
    notice.value = {
      kind: "success",
      message:
        "Redacted field review pack exported. Verify it independently before sharing; it is not a recovery bundle or Freedom grade.",
    };
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runFreedomDeviceSave(input: FreedomTestDeviceInput): Promise<void> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return;
  action.value = "freedom-device";
  try {
    await saveFreedomTestDevice(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message: "Exact device metadata added to the hash-chained field record.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runFreedomObservationSave(
  stepId: string,
  input: FreedomTestObservationInput,
): Promise<void> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return;
  action.value = "freedom-step";
  try {
    await saveFreedomTestObservation(current.station.id, stepId, input, ownerToken.value);
    notice.value = {
      kind: input.outcome === "pass" ? "success" : "error",
      message: `Witnessed field result recorded as ${input.outcome}. This remains unreviewed evidence.`,
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runFreedomTestStart(input: FreedomTestRunInput): Promise<void> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return;
  action.value = "freedom-run";
  try {
    await startFreedomTestRun(current.station.id, input, ownerToken.value);
    notice.value = {
      kind: "success",
      message:
        "Witnessed field run started for the exact device, authorized boot, and migration baseline.",
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

export async function runFreedomReportExport(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "freedom-export";
  try {
    await downloadFreedomTestReport(ownerToken.value, current.station.id);
    notice.value = {
      kind: "success",
      message: "Unreviewed Freedom Test report exported with its evidence-chain anchor.",
    };
  } catch (error) {
    handleError(error);
  } finally {
    action.value = null;
  }
}

function handleError(error: unknown): void {
  if (error instanceof OwnerApiError && error.status === 401) {
    setOwnerToken("");
  }
  notice.value = {
    kind: "error",
    message: error instanceof Error ? error.message : "The operation failed",
  };
}
