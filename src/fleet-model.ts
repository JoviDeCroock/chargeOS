import { signal } from "@preact/signals";

import type {
  AddStationInput,
  ChargerSetupSheet,
  CardReference,
  DelegateGrantCreated,
  DelegateGrantSummary,
  FleetCardActionResult,
  FleetCardsProjection,
  StationOwnership,
  StationRegistryProjection,
  SyncReadyResult,
} from "../shared/contracts.js";
import type { CardOwnership, CardUse } from "../shared/cards.js";
import {
  addStation,
  copyFleetCard,
  createStationDelegation,
  fetchFleetCards,
  fetchFleetDelegations,
  fetchStationRegistry,
  reissueStationPassword,
  removeFleetCard,
  retireStation,
  revokeStationDelegation,
  setFleetCardPolicy,
  setStationOwnership,
  syncReadyChargers,
} from "./fleet-client.js";
import { t, tn } from "./i18n/index.js";
import {
  action,
  handleError,
  notice,
  ownerToken,
  refreshFleet,
  refreshSnapshot,
  selectStation,
} from "./model.js";

export const stationRegistry = signal<StationRegistryProjection | null>(null);
export const fleetCards = signal<FleetCardsProjection | null>(null);
export const fleetGrants = signal<readonly DelegateGrantSummary[] | null>(null);
/** The one-time setup sheet of a charger just added; cleared when the dialog closes. */
export const setupSheet = signal<ChargerSetupSheet | null>(null);
export const lastSyncReady = signal<SyncReadyResult | null>(null);
/** A delegate secret shown once (employee page link or finance feed). */
export const issuedAccess = signal<{
  readonly created: DelegateGrantCreated;
  readonly stationId: string | null;
} | null>(null);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Optional extras: an older server without them keeps the console working. */
export async function refreshFleetExtras(): Promise<void> {
  const token = ownerToken.value;
  if (!token) return;
  const [registry, cards, grants] = await Promise.allSettled([
    fetchStationRegistry(token),
    fetchFleetCards(token),
    fetchFleetDelegations(token),
  ]);
  // Older servers answer these routes differently; keep only the shapes this console understands.
  stationRegistry.value =
    registry.status === "fulfilled" &&
    Array.isArray(registry.value?.stations) &&
    Array.isArray(registry.value?.retired)
      ? registry.value
      : null;
  fleetCards.value =
    cards.status === "fulfilled" && Array.isArray(cards.value?.cards) ? cards.value : null;
  fleetGrants.value =
    grants.status === "fulfilled" && Array.isArray(grants.value) ? grants.value : null;
}

async function run<T>(
  name: NonNullable<typeof action.value>,
  work: (token: string) => Promise<T>,
  success?: string,
): Promise<T | null> {
  const token = ownerToken.value;
  if (!token) return null;
  action.value = name;
  try {
    const result = await work(token);
    if (success) notice.value = { kind: "success", message: success };
    return result;
  } catch (error) {
    handleError(error);
    return null;
  } finally {
    action.value = null;
  }
}

export async function runAddStation(input: AddStationInput): Promise<string | null> {
  const result = await run("directory", (token) => addStation(input, token));
  if (!result) return null;
  setupSheet.value = result.setupSheet;
  await refreshFleet(false);
  await refreshFleetExtras();
  return result.stationId;
}

export async function runReissuePassword(stationId: string): Promise<boolean> {
  const result = await run("directory", (token) => reissueStationPassword(stationId, token));
  if (!result) return false;
  setupSheet.value = result.setupSheet;
  return true;
}

export async function runRetireStation(stationId: string, confirmation: string): Promise<boolean> {
  const done = await run(
    "directory",
    (token) => retireStation(stationId, confirmation, token),
    t("fleet.notice.retired"),
  );
  if (!done) return false;
  await refreshFleet(false);
  await refreshFleetExtras();
  return true;
}

export async function runSetOwnership(
  stationId: string,
  ownership: StationOwnership,
): Promise<void> {
  const done = await run("directory", (token) => setStationOwnership(stationId, ownership, token));
  if (done) {
    stationRegistry.value = done;
    await refreshFleet(false);
  }
}

export async function runSetCardPolicy(
  card: CardReference,
  ownership: CardOwnership,
  use: CardUse,
): Promise<boolean> {
  const done = await run(
    "directory",
    (token) => setFleetCardPolicy(card, ownership, use, token),
    t("fleet.notice.classified"),
  );
  if (!done) return false;
  fleetCards.value = done;
  await refreshSnapshot(false);
  return true;
}

export async function runCopyCard(
  card: CardReference,
  toStationIds: readonly string[],
): Promise<FleetCardActionResult | null> {
  const result = await run("owner-tag-add", (token) => copyFleetCard(card, toStationIds, token));
  if (result) {
    notice.value = {
      kind: "success",
      message: tn(
        "fleet.notice.copied",
        result.stations.filter(({ outcome }) => outcome === "added").length,
      ),
    };
    await refreshSnapshot(false);
    await refreshFleetExtras();
  }
  return result;
}

export async function runRemoveEverywhere(
  card: CardReference,
): Promise<FleetCardActionResult | null> {
  const result = await run("owner-tag-revoke", (token) => removeFleetCard(card, token));
  if (result) {
    const kept = result.stations.filter(({ outcome }) => outcome === "kept-last-card").length;
    notice.value = {
      kind: kept ? "error" : "success",
      message: kept
        ? tn("fleet.notice.removedKept", kept)
        : tn(
            "fleet.notice.removedEverywhere",
            result.stations.filter(({ outcome }) => outcome === "removed").length,
          ),
    };
    await refreshSnapshot(false);
    await refreshFleetExtras();
  }
  return result;
}

export async function runSyncReady(): Promise<SyncReadyResult | null> {
  const result = await run("sync", (token) => syncReadyChargers(token));
  if (result) {
    lastSyncReady.value = result;
    const synced = result.stations.filter(({ outcome }) => outcome === "synced").length;
    const failed = result.stations.filter(({ outcome }) => outcome === "failed").length;
    notice.value = {
      kind: failed ? "error" : "success",
      message: failed
        ? t("fleet.notice.syncSomeFailed", { failed, total: synced + failed })
        : tn("fleet.notice.syncDone", synced),
    };
    await refreshSnapshot(false);
    await refreshFleetExtras();
  }
  return result;
}

/** Employee page access on that person's own charger, valid 90 days. */
export async function runIssueDriverAccess(stationId: string): Promise<void> {
  const created = await run("delegate-issue", (token) =>
    createStationDelegation(
      stationId,
      { expiresAt: new Date(Date.now() + 90 * DAY_MS - 60_000).toISOString(), role: "driver" },
      token,
    ),
  );
  if (created) issuedAccess.value = { created, stationId };
}

/** Finance feed on the whole fleet; renewing issues a new 90-day secret and ends the old one. */
export async function runIssueFinanceFeed(replacing: string | null): Promise<void> {
  const created = await run("delegate-issue", async (token) => {
    const next = await createStationDelegation(
      null,
      { expiresAt: new Date(Date.now() + 90 * DAY_MS - 60_000).toISOString(), role: "finance" },
      token,
    );
    if (replacing) await revokeStationDelegation(null, replacing, token);
    return next;
  });
  if (created) {
    issuedAccess.value = { created, stationId: null };
    await refreshFleetExtras();
  }
}

export async function runRevokeAccess(stationId: string | null, grantId: string): Promise<boolean> {
  const done = await run(
    "delegate-revoke",
    (token) => revokeStationDelegation(stationId, grantId, token),
    t("notice.delegateRevoked"),
  );
  if (done) await refreshFleetExtras();
  return Boolean(done);
}

export function openStation(stationId: string): void {
  selectStation(stationId);
  void refreshSnapshot();
}
