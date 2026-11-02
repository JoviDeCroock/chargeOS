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
import type {
  CardProfileInput,
  DirectoryPerson,
  OwnerDirectory,
  StationProfileInput,
} from "../shared/directory.js";
import { usageReportCsv } from "../shared/usage.js";
import { t, type MessageKey } from "./i18n/index.js";
import {
  addOwnerTag,
  addPerson,
  fetchDirectory,
  removePerson,
  renamePerson,
  saveCardProfile,
  saveStationProfile,
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
  | "directory"
  | null
>(null);
export const notice = signal<{ kind: "error" | "success"; message: string } | null>(null);
export const issuedDelegate = signal<DelegateGrantCreated | null>(null);
export const usageReport = signal<UsageReport | null>(null);
export const usageLoading = signal(false);
/** Owner-chosen names for chargers, people and cards. `null` until loaded or on an older server. */
export const directory = signal<OwnerDirectory | null>(null);

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
  directory.value = null;
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
      message: t("notice.delegateIssued"),
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
      message: t("notice.delegateRevoked"),
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
    const [nextSnapshot, nextFleet] = await Promise.all([
      fetchSnapshot(selectedStationId.value, ownerToken.value),
      fetchFleet(ownerToken.value),
      loadDirectory(),
    ]);
    snapshot.value = nextSnapshot;
    fleet.value = nextFleet;
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
      const [nextSnapshot] = await Promise.all([
        fetchSnapshot(selected, ownerToken.value),
        loadDirectory(),
      ]);
      snapshot.value = nextSnapshot;
    } else {
      await loadDirectory();
    }
    if (clearNotice) notice.value = null;
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
  }
}

/** Names are optional: an older server without the directory keeps the console working. */
async function loadDirectory(): Promise<void> {
  try {
    directory.value = await fetchDirectory(ownerToken.value);
  } catch (error) {
    if (error instanceof OwnerApiError && error.status === 401) throw error;
    directory.value = null;
  }
}

async function runDirectoryChange(
  change: (token: string) => Promise<OwnerDirectory>,
  success: MessageKey,
): Promise<boolean> {
  if (!ownerToken.value) return false;
  action.value = "directory";
  try {
    directory.value = await change(ownerToken.value);
    notice.value = { kind: "success", message: t(success) };
    // Station names and drivers also appear in the fleet, snapshot and usage projections.
    fleet.value = await fetchFleet(ownerToken.value);
    if (selectedStationId.value) {
      snapshot.value = await fetchSnapshot(selectedStationId.value, ownerToken.value);
    }
    usageReport.value = null;
    return true;
  } catch (error) {
    handleError(error);
    return false;
  } finally {
    action.value = null;
  }
}

export function runSaveStation(stationId: string, input: StationProfileInput): Promise<boolean> {
  return runDirectoryChange(
    (token) => saveStationProfile(stationId, input, token),
    "notice.stationSaved",
  );
}

export function runSaveCard(
  stationId: string,
  tagPseudonym: string,
  input: CardProfileInput,
): Promise<boolean> {
  return runDirectoryChange(
    (token) => saveCardProfile(stationId, tagPseudonym, input, token),
    "notice.cardSaved",
  );
}

export async function runAddPerson(name: string): Promise<DirectoryPerson | null> {
  let created: DirectoryPerson | null = null;
  await runDirectoryChange(async (token) => {
    const result = await addPerson(name, token);
    created = result.person;
    return result.directory;
  }, "notice.personAdded");
  return created;
}

export function runRenamePerson(personId: string, name: string): Promise<boolean> {
  return runDirectoryChange(
    async (token) => (await renamePerson(personId, name, token)).directory,
    "notice.personSaved",
  );
}

export function runRemovePerson(personId: string): Promise<boolean> {
  return runDirectoryChange(
    async (token) => (await removePerson(personId, token)).directory,
    "notice.personRemoved",
  );
}

let latestUsageRequest = 0;

export async function refreshUsage(month: string): Promise<void> {
  if (!ownerToken.value) return;
  const request = ++latestUsageRequest;
  usageLoading.value = true;
  try {
    const report = await fetchUsageReport(month, browserTimeZone(), ownerToken.value);
    // A slower answer for a month the owner already left must not replace the newer one.
    if (request === latestUsageRequest) usageReport.value = report;
  } catch (error) {
    if (request === latestUsageRequest) handleError(error);
  } finally {
    if (request === latestUsageRequest) usageLoading.value = false;
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
      message: t(result.state === "ready" ? "notice.inspectReady" : "notice.inspectBlocked"),
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
        ? t("notice.preparedChanged", { count: result.changes.length })
        : t("notice.preparedUnchanged"),
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
  const name = stationCommandLabel(command.type);
  const status = command.status ?? "—";
  switch (command.state) {
    case "accepted":
      return t("command.message.accepted", { name });
    case "rejected":
      return t("command.message.rejected", { name, status });
    case "failed":
      return t("command.message.failed", { name, status });
    case "uncertain":
      return t("command.message.uncertain", { name, status });
    case "pending":
      return t("command.message.pending", { name });
  }
}

const STATION_COMMAND_LABEL_KEYS: Readonly<Record<StationCommandRecord["type"], MessageKey>> = {
  ChangeAvailability: "command.type.ChangeAvailability",
  RemoteStartTransaction: "command.type.RemoteStartTransaction",
  RemoteStopTransaction: "command.type.RemoteStopTransaction",
  Reset: "command.type.Reset",
  UnlockConnector: "command.type.UnlockConnector",
};

export function stationCommandLabel(type: StationCommandRecord["type"]): string {
  return t(STATION_COMMAND_LABEL_KEYS[type]);
}

export async function runAuthorizationSync(): Promise<void> {
  const current = snapshot.value;
  if (!current || !ownerToken.value) return;
  action.value = "sync";
  try {
    const result = await syncAuthorizations(current.station.id, ownerToken.value);
    notice.value = {
      kind: "success",
      message: t("notice.synced", { revision: result.listVersion }),
    };
    await refreshSnapshot(false);
  } catch (error) {
    handleError(error);
    await refreshSnapshot(false);
  } finally {
    action.value = null;
  }
}

/**
 * Adds an owner card to the selected charger's desired list, then names it. The raw card value is
 * sent once and never kept in the browser; the name is attached to the returned pseudonym.
 */
/**
 * Adds a card, then names it. A new holder is created only after the card itself was added, so a
 * refused card never leaves an orphan person behind.
 */
export async function runOwnerTagAdd(
  input: OwnerTagAddInput,
  profile?: CardProfileInput & { readonly newHolderName?: string },
): Promise<boolean> {
  const current = snapshot.value;
  if (!ownerToken.value || !current) return false;
  action.value = "owner-tag-add";
  try {
    const result = await addOwnerTag(current.station.id, input, ownerToken.value);
    let named = true;
    if (profile) {
      try {
        let holderPersonId = profile.holderPersonId;
        if (profile.newHolderName) {
          const created = await addPerson(profile.newHolderName, ownerToken.value);
          directory.value = created.directory;
          holderPersonId = created.person.id;
        }
        if (profile.name !== null || holderPersonId !== null) {
          directory.value = await saveCardProfile(
            current.station.id,
            result.tagPseudonym,
            { holderPersonId, name: profile.name },
            ownerToken.value,
          );
        }
      } catch {
        named = false;
      }
    }
    notice.value = {
      kind: named ? "success" : "error",
      message: t(named ? "notice.cardAdded" : "notice.cardAddedUnnamed"),
    };
    await refreshSnapshot(false);
    return true;
  } catch (error) {
    handleError(error);
    return false;
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
      message: t("notice.cardRemoved"),
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
      message: t("notice.evidenceExported"),
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
    message: error instanceof Error ? error.message : t("notice.failed"),
  };
}
