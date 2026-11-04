import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  isCardOwnership,
  isCardUse,
  type CardReference,
  type FleetCard,
  type FleetCardActionResult,
  type FleetCardsProjection,
  type SyncReadyResult,
  type SyncReadyReview,
} from "../shared/cards.js";
import type { FleetSnapshot, OwnerSnapshot } from "../shared/contracts.js";
import { PERSON_ID_PATTERN, TAG_PSEUDONYM_PATTERN } from "../shared/directory.js";
import type { DriverView, ReimbursementFeed } from "../shared/driver.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import type { AddStationResult, ChargerSetupSheet } from "../shared/stations.js";
import { parseTimeZone, parseUsageMonth, sessionsInMonth } from "../shared/usage.js";
import { objectWithExactKeys, readJsonBody, sendError, sendJson } from "./api.js";
import {
  cardPolicyHistory,
  CardPolicyInputError,
  CardPolicyUnavailableError,
  type CardPolicyStore,
} from "./card-policy.js";
import { configForStation, UnknownStationError, type GatewayConfig } from "./config.js";
import {
  hasDelegateScope,
  projectDelegateGrants,
  recordDelegateUse,
  type DelegatePrincipal,
} from "./delegation.js";
import type { OwnerDirectoryStore } from "./directory.js";
import type { EvidenceEvent, EvidenceStore } from "./events.js";
import {
  ReviewedLocalListChangedError,
  type ChargeGateway,
  type ReviewedLocalList,
} from "./gateway.js";
import { buildStationSetup } from "./onboarding.js";
import {
  openAddedStationOwnerTags,
  OwnerTagConflictError,
  OwnerTagInputError,
  reissueEmptyOwnerTags,
  type OwnerTagRegistry,
} from "./owner-tags.js";
import { buildFleetSnapshot, buildOwnerSnapshot, stationSessions } from "./projections.js";
import {
  StationRegistryConflictError,
  StationRegistryInputError,
  type StationRegistry,
} from "./station-registry.js";
import { foldIdTag, pseudonymizeTag } from "./tag.js";
import { isStationOwnership, type AddStationInput } from "../shared/stations.js";

/** The company-gateway services the owner API needs beyond the original single-charger edge. */
export interface FleetServices {
  readonly cardPolicy: CardPolicyStore;
  /**
   * Chargers whose current tap-to-add listening was started by the employee's own link. An owner
   * start clears the mark, so an employee can never add (as personal) a card the owner is adding.
   */
  readonly driverCaptures: Set<string>;
  readonly registries: Map<string, OwnerTagRegistry>;
  readonly stations: StationRegistry;
}

type Events = readonly EvidenceEvent[];

/* ------------------------------------------------------------------ */
/* Owner routes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Owner-only fleet routes. Returns `false` when the path is not one of them. Every station-scoped
 * route resolves the charger first and rejects unknown IDs.
 */
export async function handleFleetOwnerApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  services: FleetServices,
  directory: OwnerDirectoryStore,
): Promise<boolean> {
  const method = request.method;
  const path = url.pathname;

  if (path === "/api/v1/fleet" && method === "GET") {
    sendJson(
      response,
      200,
      fleetSnapshot(config, gateway, await evidence.readEvents(), services, directory),
    );
    return true;
  }
  if (path === "/api/v1/stations-registry" && method === "GET") {
    sendJson(response, 200, services.stations.project(config));
    return true;
  }
  if (path === "/api/v1/managed-stations" && method === "POST") {
    await respond(response, async () => {
      const result = await addStation(
        config,
        evidence,
        services,
        directory,
        await readJsonBody(request),
      );
      return [201, result];
    });
    return true;
  }
  if (path === "/api/v1/fleet-cards" && method === "GET") {
    sendJson(response, 200, fleetCards(config, gateway, await evidence.readEvents(), services));
    return true;
  }
  if (path === "/api/v1/fleet-cards/copy" && method === "POST") {
    await respond(response, async () => [
      200,
      await copyCard(config, evidence, services, directory, await readJsonBody(request)),
    ]);
    return true;
  }
  if (path === "/api/v1/fleet-cards/remove" && method === "POST") {
    await respond(response, async () => [
      200,
      await removeCardEverywhere(
        config,
        evidence,
        services,
        directory,
        await readJsonBody(request),
      ),
    ]);
    return true;
  }
  if (path === "/api/v1/fleet-cards/policy" && method === "POST") {
    await respond(response, async () => {
      const input = objectWithExactKeys(await readJsonBody(request), ["card", "ownership", "use"]);
      if (!input || !isCardOwnership(input.ownership) || !isCardUse(input.use)) {
        throw new CardPolicyInputError("request must contain card, ownership and use");
      }
      const members = cardMembers(config, services, cardReference(input.card));
      await services.cardPolicy.set(config, evidence, members, input.ownership, input.use);
      return [200, fleetCards(config, gateway, await evidence.readEvents(), services)];
    });
    return true;
  }
  if (path === "/api/v1/sync-ready" && method === "GET") {
    sendJson(response, 200, reviewSync(config, gateway, await evidence.readEvents()).review);
    return true;
  }
  if (path === "/api/v1/sync-ready" && method === "POST") {
    await respond(response, async () => {
      const body = objectWithExactKeys(await readJsonBody(request), ["reviewId"]);
      if (typeof body?.reviewId !== "string" || !/^[a-f0-9]{64}$/u.test(body.reviewId)) {
        sendError(
          response,
          400,
          "sync_review_required",
          "Review the charger list before sending cards",
        );
        return null;
      }
      const { review, targets } = reviewSync(config, gateway, await evidence.readEvents());
      if (
        !timingSafeEqual(Buffer.from(review.reviewId, "hex"), Buffer.from(body.reviewId, "hex"))
      ) {
        sendError(
          response,
          409,
          "sync_review_changed",
          "The charger list changed. Review it again.",
        );
        return null;
      }
      return [200, await syncReady(review, targets, gateway)];
    });
    return true;
  }

  const match = path.match(
    /^\/api\/v1\/stations\/([^/]+)\/(snapshot|retire|reissue-password|ownership|card-capture|card-capture\/register)$/u,
  );
  const legacySnapshot = path === "/api/v1/snapshot";
  if (path === "/api/v1/card-capture" && method === "POST") {
    // The legacy route addresses the first charger; an owner start takes listening over.
    services.driverCaptures.delete(config.stationId);
    return false;
  }
  if (!match && !legacySnapshot) return false;
  let stationConfig: GatewayConfig;
  try {
    stationConfig = configForStation(
      config,
      legacySnapshot ? config.stationId : decodeURIComponent(match![1] ?? ""),
    );
  } catch (error) {
    if (error instanceof UnknownStationError || error instanceof URIError) {
      sendError(response, 404, "station_not_found", "Charge point not found");
      return true;
    }
    throw error;
  }
  const stationId = stationConfig.stationId;
  const action = legacySnapshot ? "snapshot" : match![2];

  if (action === "snapshot" && method === "GET") {
    const events = await evidence.readEvents();
    sendJson(response, 200, ownerSnapshot(stationConfig, gateway, events, services, directory));
    return true;
  }
  if (action === "retire" && method === "POST") {
    await respond(response, async () => {
      const input = objectWithExactKeys(await readJsonBody(request), ["confirmation"]);
      if (!input) throw new StationRegistryInputError("request must contain only confirmation");
      await services.stations.retire(config, evidence, stationId, input.confirmation);
      services.driverCaptures.delete(stationId);
      await gateway.disconnectStation?.(stationId);
      await directory.forgetRevokedCards(config).catch(() => undefined);
      return [200, services.stations.project(config)];
    });
    return true;
  }
  if (action === "reissue-password" && method === "POST") {
    await respond(response, async () => {
      const events = (await evidence.readEvents()).filter((event) => event.stationId === stationId);
      const previous = services.registries.get(stationId);
      const hasHistory =
        hasConnected(events) ||
        gateway.getRuntime(stationId).connected ||
        (previous?.tags.size ?? 0) > 0;
      const { secret } = await services.stations.reissueSecret(evidence, stationId, hasHistory);
      services.driverCaptures.delete(stationId);
      await gateway.disconnectStation?.(stationId);
      if (previous) {
        const registry = await reissueEmptyOwnerTags(config, stationId, previous);
        await registry.reconcile(configForStation(config, stationId), evidence);
        services.registries.set(stationId, registry);
        services.stations.setOwnerTags(stationId, registry.tags);
      }
      const result: AddStationResult = {
        setupSheet: setupSheet(config, stationId, secret),
        stationId,
      };
      return [200, result];
    });
    return true;
  }
  if (action === "ownership" && method === "POST") {
    await respond(response, async () => {
      const input = objectWithExactKeys(await readJsonBody(request), ["ownership"]);
      if (!input || !isStationOwnership(input.ownership)) {
        throw new StationRegistryInputError("ownership must be company or employee");
      }
      await services.stations.setOwnership(evidence, stationId, input.ownership);
      return [200, services.stations.project(config)];
    });
    return true;
  }
  if (action === "card-capture" && method === "POST") {
    // Listening itself is the gateway's owner route; an owner start takes listening over.
    services.driverCaptures.delete(stationId);
    return false;
  }
  if (action === "card-capture/register" && method === "POST") {
    await respond(response, async () => {
      const input = objectWithExactKeys(await readJsonBody(request), [
        "holderPersonId",
        "name",
        "ownership",
        "tagPseudonym",
        "use",
      ]);
      if (
        !input ||
        !isCardOwnership(input.ownership) ||
        !isCardUse(input.use) ||
        (input.holderPersonId !== null &&
          (typeof input.holderPersonId !== "string" ||
            !PERSON_ID_PATTERN.test(input.holderPersonId))) ||
        (input.name !== null && typeof input.name !== "string")
      ) {
        throw new CardPolicyInputError(
          "request must contain tagPseudonym, ownership, use, name and holderPersonId",
        );
      }
      const added = await registerCapturedCard(
        config,
        gateway,
        evidence,
        services,
        stationId,
        input.tagPseudonym,
        {
          ownership: input.ownership,
          use: input.use,
        },
      );
      if (input.name !== null || input.holderPersonId !== null) {
        // Names are presentation only; a refused name never undoes the card.
        await directory
          .updateCard(stationConfig, added.tagPseudonym, {
            holderPersonId: input.holderPersonId as string | null,
            name: typeof input.name === "string" && input.name.trim() ? input.name : null,
          })
          .catch(() => undefined);
      }
      return [201, added];
    });
    return true;
  }
  return false;
}

/** Runs after a card revoke from the original route: drop classifications of removed cards. */
export async function afterCardRevoked(
  config: GatewayConfig,
  services: FleetServices,
): Promise<void> {
  await services.cardPolicy.prune(config).catch(() => undefined);
}

function fleetSnapshot(
  config: GatewayConfig,
  gateway: ChargeGateway,
  events: Events,
  services: FleetServices,
  directory: OwnerDirectoryStore,
): FleetSnapshot {
  return buildFleetSnapshot(
    config,
    gateway,
    events,
    directory.stationNames(config),
    (stationId, snapshot, stationEvents) => ({
      ownership: services.stations.ownership(stationId),
      setup: buildStationSetup(
        snapshot,
        services.stations.expected(stationId),
        hasConnected(stationEvents),
      ).state,
    }),
  );
}

export function ownerSnapshot(
  stationConfig: GatewayConfig,
  gateway: ChargeGateway,
  events: Events,
  services: FleetServices,
  directory: OwnerDirectoryStore,
): OwnerSnapshot {
  const stationId = stationConfig.stationId;
  const snapshot = buildOwnerSnapshot(
    stationConfig,
    gateway,
    events,
    directory.stationNames(stationConfig),
  );
  const expected = services.stations.expected(stationId);
  const stationEvents = events.filter((event) => event.stationId === stationId);
  return {
    ...snapshot,
    cardPolicies: snapshot.authorization.tagPseudonyms.flatMap((tagPseudonym) => {
      const policy = services.cardPolicy.get(stationId, tagPseudonym);
      return policy ? [{ tagPseudonym, ...policy }] : [];
    }),
    setup: buildStationSetup(snapshot, expected, hasConnected(stationEvents)),
    station: {
      ...snapshot.station,
      expected,
      managed: services.stations.isManaged(stationId),
      ownership: services.stations.ownership(stationId),
    },
  };
}

async function addStation(
  config: GatewayConfig,
  evidence: EvidenceStore,
  services: FleetServices,
  directory: OwnerDirectoryStore,
  body: Record<string, unknown>,
): Promise<AddStationResult> {
  const input = objectWithExactKeys(body, [
    "driverPersonId",
    "expected",
    "id",
    "label",
    "ownership",
    "site",
  ]);
  if (!input) {
    throw new StationRegistryInputError(
      "request must contain id, label, site, ownership, driverPersonId and expected",
    );
  }
  if (input.id !== null && typeof input.id !== "string") {
    throw new StationRegistryInputError("id must be text or null");
  }
  if (
    input.driverPersonId !== null &&
    (typeof input.driverPersonId !== "string" || !PERSON_ID_PATTERN.test(input.driverPersonId))
  ) {
    throw new StationRegistryInputError("driverPersonId must be a person or null");
  }
  const { secret, station } = await services.stations.add(evidence, {
    driverPersonId: input.driverPersonId as string | null,
    expected: input.expected as AddStationInput["expected"],
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : null,
    label: input.label as string,
    ownership: input.ownership as AddStationInput["ownership"],
    site: input.site as string,
  });
  const registry = await openAddedStationOwnerTags(config, station.id);
  services.registries.set(station.id, registry);
  services.stations.setOwnerTags(station.id, registry.tags);
  await registry.reconcile(configForStation(config, station.id), evidence);
  await directory
    .updateStation(station.id, {
      driverPersonId: input.driverPersonId as string | null,
      label: station.label,
      site: station.site,
    })
    .catch(() => undefined);
  return { setupSheet: setupSheet(config, station.id, secret), stationId: station.id };
}

function setupSheet(config: GatewayConfig, stationId: string, password: string): ChargerSetupSheet {
  return {
    endpoint: config.ocppPublicUrl
      ? `${config.ocppPublicUrl}${encodeURIComponent(stationId)}`
      : null,
    password,
    protocol: "OCPP 1.6J",
    stationId,
  };
}

/* ------------------------------------------------------------------ */
/* Cards across chargers                                               */
/* ------------------------------------------------------------------ */

function rawTagFor(config: GatewayConfig, reference: CardReference): string {
  const station = configForStation(config, reference.stationId);
  const tag = [...station.ownerTags].find(
    (candidate) =>
      `tag_${pseudonymizeTag(candidate, station.stationSecret)}` === reference.tagPseudonym,
  );
  if (!tag) throw new OwnerTagConflictError("Card is not an owner card of that charger");
  return tag;
}

/** Every charger whose desired list holds this card (letter case folded like online checks). */
function membersOfTag(
  config: GatewayConfig,
  tag: string,
): { stationId: string; tagPseudonym: string; tag: string }[] {
  const folded = foldIdTag(tag);
  const members: { stationId: string; tagPseudonym: string; tag: string }[] = [];
  for (const station of config.stations ?? []) {
    for (const candidate of station.ownerTags) {
      if (foldIdTag(candidate) === folded) {
        members.push({
          stationId: station.id,
          tag: candidate,
          tagPseudonym: `tag_${pseudonymizeTag(candidate, station.secret)}`,
        });
      }
    }
  }
  return members;
}

function cardMembers(
  config: GatewayConfig,
  _services: FleetServices,
  reference: CardReference,
): { stationId: string; tagPseudonym: string }[] {
  return membersOfTag(config, rawTagFor(config, reference)).map(({ stationId, tagPseudonym }) => ({
    stationId,
    tagPseudonym,
  }));
}

function fleetCards(
  config: GatewayConfig,
  gateway: ChargeGateway,
  events: Events,
  services: FleetServices,
): FleetCardsProjection {
  const groups = new Map<string, FleetCard["members"][number][]>();
  const acknowledged = new Map<string, ReadonlySet<string>>();
  for (const station of config.stations ?? []) {
    const scoped = configForStation(config, station.id);
    acknowledged.set(
      station.id,
      new Set(buildOwnerSnapshot(scoped, gateway, events).authorization.acknowledgedTagPseudonyms),
    );
    for (const tag of station.ownerTags) {
      const tagPseudonym = `tag_${pseudonymizeTag(tag, station.secret)}`;
      const members = groups.get(foldIdTag(tag)) ?? [];
      members.push({
        onCharger: acknowledged.get(station.id)!.has(tagPseudonym),
        stationId: station.id,
        tagPseudonym,
      });
      groups.set(foldIdTag(tag), members);
    }
  }
  return {
    cards: [...groups.values()].map((members) => ({
      members,
      policy:
        members
          .map(({ stationId, tagPseudonym }) => services.cardPolicy.get(stationId, tagPseudonym))
          .find((policy) => policy !== null) ?? null,
    })),
  };
}

async function copyCard(
  config: GatewayConfig,
  evidence: EvidenceStore,
  services: FleetServices,
  directory: OwnerDirectoryStore,
  body: Record<string, unknown>,
): Promise<FleetCardActionResult> {
  const input = objectWithExactKeys(body, ["card", "toStationIds"]);
  if (
    !input ||
    !Array.isArray(input.toStationIds) ||
    input.toStationIds.length < 1 ||
    input.toStationIds.length > 1_000 ||
    !input.toStationIds.every((id) => typeof id === "string")
  ) {
    throw new OwnerTagInputError("request must contain card and toStationIds");
  }
  const reference = cardReference(input.card);
  const tag = rawTagFor(config, reference);
  const policy = services.cardPolicy.get(reference.stationId, reference.tagPseudonym);
  const name = directory
    .project(config)
    .cards.find(
      (card) =>
        card.stationId === reference.stationId && card.tagPseudonym === reference.tagPseudonym,
    );
  // Resolve every target before changing anything, so an unknown charger changes nothing.
  const targets = [...new Set(input.toStationIds as string[])].map((id) =>
    configForStation(config, id),
  );
  const results: {
    outcome: FleetCardActionResult["stations"][number]["outcome"];
    stationId: string;
  }[] = [];
  for (const target of targets) {
    const registry = services.registries.get(target.stationId);
    if (!registry) throw new OwnerTagConflictError("Owner tag registry is missing for a station");
    if ([...registry.tags].some((existing) => foldIdTag(existing) === foldIdTag(tag))) {
      results.push({ outcome: "already-present", stationId: target.stationId });
      continue;
    }
    const added = await registry.add(target, evidence, tag);
    results.push({ outcome: "added", stationId: target.stationId });
    if (policy) {
      await services.cardPolicy
        .set(
          config,
          evidence,
          [{ stationId: target.stationId, tagPseudonym: added.tagPseudonym }],
          policy.ownership,
          policy.use,
        )
        .catch(() => undefined);
    }
    if (name && (name.name !== null || name.holderPersonId !== null)) {
      await directory
        .updateCard(target, added.tagPseudonym, {
          holderPersonId: name.holderPersonId,
          name: name.name,
        })
        .catch(() => undefined);
    }
  }
  return { stations: results };
}

async function removeCardEverywhere(
  config: GatewayConfig,
  evidence: EvidenceStore,
  services: FleetServices,
  directory: OwnerDirectoryStore,
  body: Record<string, unknown>,
): Promise<FleetCardActionResult> {
  const input = objectWithExactKeys(body, ["card", "confirmation"]);
  if (!input || input.confirmation !== OWNER_TAG_REVOCATION_CONFIRMATION) {
    throw new OwnerTagInputError("request must contain card and the exact confirmation phrase");
  }
  const tag = rawTagFor(config, cardReference(input.card));
  const results: {
    outcome: FleetCardActionResult["stations"][number]["outcome"];
    stationId: string;
  }[] = [];
  const seen = new Set<string>();
  for (const member of membersOfTag(config, tag)) {
    // Case variants on one charger are removed together by the registry.
    if (seen.has(member.stationId)) continue;
    seen.add(member.stationId);
    const registry = services.registries.get(member.stationId);
    if (!registry) continue;
    try {
      await registry.revoke(
        configForStation(config, member.stationId),
        evidence,
        member.tagPseudonym,
        {
          confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
        },
      );
      results.push({ outcome: "removed", stationId: member.stationId });
    } catch (error) {
      if (error instanceof OwnerTagConflictError && error.message.startsWith("At least one")) {
        results.push({ outcome: "kept-last-card", stationId: member.stationId });
        continue;
      }
      throw error;
    }
  }
  await directory.forgetRevokedCards(config).catch(() => undefined);
  await afterCardRevoked(config, services);
  return { stations: results };
}

function reviewSync(config: GatewayConfig, gateway: ChargeGateway, events: Events) {
  const targets = new Map<string, ReviewedLocalList>();
  const fingerprint = createHmac("sha256", config.ownerApiToken).update(
    "chargeOS fleet sync review v1",
  );
  const stations: SyncReadyReview["stations"] = (config.stations ?? []).map(({ id }) => {
    const { authorization, station, readiness } = buildOwnerSnapshot(
      configForStation(config, id),
      gateway,
      events,
    );
    const localListVersion = readiness?.localListVersion ?? null;
    const state =
      authorization.tagCount === 0
        ? "no-cards"
        : !station.connected
          ? "offline"
          : readiness?.state !== "ready" || readiness.restartRequired || localListVersion === null
            ? "not-ready"
            : authorization.syncState === "current"
              ? "already-current"
              : "eligible";
    const row = {
      stationId: id,
      state,
      additions: authorization.pendingAdditions.length,
      removals: authorization.pendingRevocations.length,
    } as const;
    if (state === "eligible" && localListVersion !== null) {
      const expected = {
        connectedAt: station.connectedAt,
        localListVersion:
          authorization.lastSyncAt && readiness && authorization.lastSyncAt >= readiness.checkedAt
            ? (authorization.lastSyncRevision ?? localListVersion)
            : localListVersion,
        tagPseudonyms: authorization.tagPseudonyms,
      };
      targets.set(id, expected);
      fingerprint.update(
        JSON.stringify([
          row,
          expected,
          authorization.lastAttemptRevision,
          authorization.pendingRevision,
          authorization.acknowledgedTagPseudonyms,
          readiness?.checkedAt,
        ]),
      );
    } else {
      fingerprint.update(JSON.stringify(row));
    }
    return row;
  });
  return { review: { reviewId: fingerprint.digest("hex"), stations }, targets };
}

async function syncReady(
  review: SyncReadyReview,
  targets: ReadonlyMap<string, ReviewedLocalList>,
  gateway: ChargeGateway,
): Promise<SyncReadyResult> {
  const stations: SyncReadyResult["stations"][number][] = [];
  for (const { stationId, state } of review.stations) {
    if (state !== "eligible") {
      stations.push({ stationId, outcome: state, listVersion: null });
      continue;
    }
    try {
      const result = await gateway.syncOwnerList(stationId, targets.get(stationId)!);
      stations.push({ stationId, outcome: "synced", listVersion: result.listVersion });
    } catch (error) {
      const outcome = error instanceof ReviewedLocalListChangedError ? "changed" : "failed";
      stations.push({ stationId, outcome, listVersion: null });
    }
  }
  return { stations };
}

function cardReference(value: unknown): CardReference {
  const input = objectWithExactKeys(value, ["stationId", "tagPseudonym"]);
  if (
    !input ||
    typeof input.stationId !== "string" ||
    typeof input.tagPseudonym !== "string" ||
    !TAG_PSEUDONYM_PATTERN.test(input.tagPseudonym)
  ) {
    throw new OwnerTagInputError("card must contain stationId and tagPseudonym");
  }
  return { stationId: input.stationId, tagPseudonym: input.tagPseudonym };
}

/* ------------------------------------------------------------------ */
/* Tap-to-register                                                     */
/* ------------------------------------------------------------------ */

/** The owner is adding a card at this charger right now; the employee page must wait. */
export class CardCaptureBusyError extends Error {
  constructor() {
    super("Someone else is adding a card at this charger; try again in a few minutes");
    this.name = "CardCaptureBusyError";
  }
}

/** The tapped card could not be taken: it expired, was replaced or the pseudonym does not match. */
export class CardCaptureUnavailableError extends Error {
  constructor() {
    super("That card is no longer waiting to be added; tap it again");
    this.name = "CardCaptureUnavailableError";
  }
}

/**
 * Moves the tapped card from gateway memory into the charger's desired set and classifies it. The
 * raw value is handed over once and never returned; an expired or different pseudonym adds nothing.
 */
async function registerCapturedCard(
  config: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  services: FleetServices,
  stationId: string,
  tagPseudonym: unknown,
  policy: { ownership: "company" | "personal"; use: "business" | "private" },
  classificationRequired = false,
): Promise<{ readonly tagPseudonym: string; readonly tagCount: number }> {
  if (typeof tagPseudonym !== "string" || !TAG_PSEUDONYM_PATTERN.test(tagPseudonym)) {
    throw new OwnerTagInputError("tagPseudonym must be a card reference");
  }
  const registry = services.registries.get(stationId);
  if (!registry) throw new OwnerTagConflictError("Owner tag registry is missing for a station");
  // An employee's card must be recorded as personal and private, or it would be unmanageable for
  // them and unmarked in the reimbursement feed; refuse before the tap is consumed.
  if (classificationRequired && !services.cardPolicy.writable) {
    throw new CardPolicyUnavailableError();
  }
  // The owner adds a charger's first card. A charger always keeps at least one card, so an
  // employee's card that became the only one could not be taken back if recording it failed.
  if (classificationRequired && registry.tags.size === 0) {
    throw new OwnerTagConflictError("The owner adds the first card to this charger");
  }
  const tag = gateway.takeCapturedCard(stationId, tagPseudonym);
  if (!tag) throw new CardCaptureUnavailableError();
  const stationConfig = configForStation(config, stationId);
  const result = await registry.add(stationConfig, evidence, tag);
  try {
    await services.cardPolicy.set(
      config,
      evidence,
      [{ stationId, tagPseudonym: result.tagPseudonym }],
      policy.ownership,
      policy.use,
    );
  } catch (error) {
    if (!classificationRequired) {
      // The owner sees the card as unclassified and can classify it again.
      return { tagCount: result.tagCount, tagPseudonym: result.tagPseudonym };
    }
    await registry.revoke(configForStation(config, stationId), evidence, result.tagPseudonym, {
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    throw error;
  }
  return { tagCount: result.tagCount, tagPseudonym: result.tagPseudonym };
}

/* ------------------------------------------------------------------ */
/* Delegate routes: employee self-service and reimbursement feed       */
/* ------------------------------------------------------------------ */

export async function handleFleetDelegateApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  rootConfig: GatewayConfig,
  stationConfig: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  services: FleetServices,
  principal: DelegatePrincipal,
): Promise<boolean> {
  const path = url.pathname;
  const stationId = stationConfig.stationId;
  if (path === "/api/v1/delegate/reimbursement" && request.method === "GET") {
    if (!hasDelegateScope(principal, "reimbursement:read")) {
      sendError(response, 403, "insufficient_scope", "Delegate token lacks reimbursement:read");
      return true;
    }
    // A fleet-wide feed is issued on, and answered for, the first charger only.
    if (stationId !== rootConfig.stationId) {
      sendError(response, 404, "not_found", "Delegate API route not found");
      return true;
    }
    await respond(response, async () => {
      const month = parseUsageMonth(url.searchParams.get("month"));
      const timeZone = parseTimeZone(url.searchParams.get("timeZone"));
      await recordDelegateUse(stationId, evidence, principal, "reimbursement:read", path);
      return [
        200,
        reimbursementFeed(rootConfig, await evidence.readEvents(), services, month, timeZone),
      ];
    });
    return true;
  }

  if (!path.startsWith("/api/v1/delegate/driver")) return false;
  const routes: Readonly<
    Record<string, { method: string; scope: "driver:read" | "driver:personal-cards" }>
  > = {
    "/api/v1/delegate/driver": { method: "GET", scope: "driver:read" },
    "/api/v1/delegate/driver/card-capture": { method: "POST", scope: "driver:personal-cards" },
    "/api/v1/delegate/driver/card-capture/cancel": {
      method: "POST",
      scope: "driver:personal-cards",
    },
    "/api/v1/delegate/driver/card-capture/confirm": {
      method: "POST",
      scope: "driver:personal-cards",
    },
    "/api/v1/delegate/driver/sync": { method: "POST", scope: "driver:personal-cards" },
  };
  const removeMatch = path.match(
    /^\/api\/v1\/delegate\/driver\/cards\/(tag_[a-f0-9]{24})\/remove$/u,
  );
  const route = removeMatch
    ? { method: "POST", scope: "driver:personal-cards" as const }
    : routes[path];
  if (!route || request.method !== route.method) {
    sendError(response, 404, "not_found", "Delegate API route not found");
    return true;
  }
  if (!hasDelegateScope(principal, route.scope)) {
    sendError(response, 403, "insufficient_scope", `Delegate token lacks ${route.scope}`);
    return true;
  }
  await respond(response, async () => {
    await recordDelegateUse(
      stationId,
      evidence,
      principal,
      route.scope,
      removeMatch ? "/api/v1/delegate/driver/cards/remove" : path,
    );
    if (path === "/api/v1/delegate/driver") {
      return [
        200,
        driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
      ];
    }
    if (path.endsWith("/card-capture")) {
      const current = buildOwnerSnapshot(
        stationConfig,
        gateway,
        await evidence.readEvents(),
      ).cardCapture;
      // Never take over listening the owner (or an installer) started: the card they tap is not
      // the employee's to claim as personal.
      if (
        !services.driverCaptures.has(stationId) &&
        (current.state === "listening" || current.state === "captured")
      ) {
        throw new CardCaptureBusyError();
      }
      gateway.armCardCapture(stationId);
      services.driverCaptures.add(stationId);
      return [
        201,
        driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
      ];
    }
    if (path.endsWith("/card-capture/cancel")) {
      if (!objectWithExactKeys(await readJsonBody(request), [])) {
        throw new OwnerTagInputError("request must be an empty JSON object");
      }
      // Only listening the employee started; the owner's own listening is left alone.
      if (services.driverCaptures.delete(stationId)) gateway.cancelCardCapture(stationId);
      return [
        200,
        driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
      ];
    }
    if (path.endsWith("/card-capture/confirm")) {
      const input = objectWithExactKeys(await readJsonBody(request), ["tagPseudonym"]);
      if (!input) throw new OwnerTagInputError("request must contain only tagPseudonym");
      if (!services.driverCaptures.has(stationId)) throw new CardCaptureUnavailableError();
      // An employee only ever adds a personal, private card to their own charger.
      await registerCapturedCard(
        rootConfig,
        gateway,
        evidence,
        services,
        stationId,
        input.tagPseudonym,
        {
          ownership: "personal",
          use: "private",
        },
        true,
      );
      services.driverCaptures.delete(stationId);
      return [
        201,
        driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
      ];
    }
    if (path.endsWith("/sync")) {
      await gateway.syncOwnerList(stationId);
      return [
        200,
        driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
      ];
    }
    // Remove a personal card.
    const tagPseudonym = removeMatch![1]!;
    const input = objectWithExactKeys(await readJsonBody(request), ["confirmation"]);
    if (!input || input.confirmation !== OWNER_TAG_REVOCATION_CONFIRMATION) {
      throw new OwnerTagInputError("request must contain only the exact confirmation phrase");
    }
    if (services.cardPolicy.get(stationId, tagPseudonym)?.ownership !== "personal") {
      sendError(response, 403, "company_card", "Only the owner can remove a company card");
      return null;
    }
    const registry = services.registries.get(stationId);
    if (!registry) throw new OwnerTagConflictError("Owner tag registry is missing for a station");
    await registry.revoke(stationConfig, evidence, tagPseudonym, {
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    await afterCardRevoked(rootConfig, services);
    return [
      200,
      driverView(stationConfig, gateway, await evidence.readEvents(), services, principal),
    ];
  });
  return true;
}

function driverView(
  stationConfig: GatewayConfig,
  gateway: ChargeGateway,
  events: Events,
  services: FleetServices,
  principal: DelegatePrincipal,
): DriverView {
  const stationId = stationConfig.stationId;
  const snapshot = buildOwnerSnapshot(stationConfig, gateway, events);
  const acknowledged = new Set(snapshot.authorization.acknowledgedTagPseudonyms);
  // History starts at the oldest employee link still active on this charger, so a renewed link
  // keeps the month whole. Offboarding ends every link, so the next employee starts fresh.
  const historyFrom = Math.min(
    Date.parse(principal.grantedAt),
    ...projectDelegateGrants(events.filter((event) => event.stationId === stationId))
      .filter(({ role, status }) => role === "driver" && status === "active")
      .map(({ createdAt }) => Date.parse(createdAt))
      .filter(Number.isFinite),
  );
  return {
    // Listening the owner started stays private to the owner.
    cardCapture: services.driverCaptures.has(stationId) ? snapshot.cardCapture : null,
    cards: snapshot.authorization.tagPseudonyms.map((tagPseudonym) => {
      const policy = services.cardPolicy.get(stationId, tagPseudonym);
      return {
        manageable: policy?.ownership === "personal" && snapshot.authorization.tagCount > 1,
        onCharger: acknowledged.has(tagPseudonym),
        ownership: policy?.ownership ?? null,
        tagPseudonym,
        use: policy?.use ?? null,
      };
    }),
    generatedAt: new Date().toISOString(),
    grant: { expiresAt: principal.expiresAt },
    offlineReady: snapshot.readiness?.state === "ready",
    // Only sessions since this link was issued: after a charger is reassigned, the new employee
    // never sees when the previous one charged.
    sessions: snapshot.sessions
      .filter(({ startedAt }) => Date.parse(startedAt) >= historyFrom)
      .slice(0, 50)
      .map((session) => ({
        energyWh: session.energyWh,
        startedAt: session.startedAt,
        status: session.status,
        stoppedAt: session.stoppedAt,
        tagPseudonym: session.tagPseudonym,
        transactionId: session.transactionId,
      })),
    station: {
      connected: snapshot.station.connected,
      connectors: snapshot.station.connectors,
      id: stationId,
    },
    syncState: snapshot.authorization.syncState,
  };
}

export function reimbursementFeed(
  config: GatewayConfig,
  events: Events,
  services: FleetServices,
  month: string,
  timeZone: string,
  now = new Date(),
): ReimbursementFeed {
  let excludedPrivateSessions = 0;
  const policyAt = cardPolicyHistory(events);
  // Retired chargers stay in the feed: their sessions happened and may still be reimbursable.
  const stationIds = [
    ...(config.stations ?? []).map(({ id }) => id),
    ...services.stations.retired.map(({ id }) => id),
  ];
  const stations = stationIds.map((stationId) => {
    const sessions = sessionsInMonth(stationSessions(events, stationId), month, timeZone)
      .filter(({ authorizationStatus }) => authorizationStatus === "Accepted")
      .flatMap((session) => {
        // Classified as the card stood when it was used, so a later removal or change of a
        // private card never makes its earlier sessions reimbursable.
        const policy = policyAt(stationId, session.tagPseudonym, session.startedAt);
        if (policy?.use === "private") {
          excludedPrivateSessions += 1;
          return [];
        }
        return [
          {
            cardOwnership: policy?.ownership ?? null,
            cardUse: policy?.use === "business" ? ("business" as const) : ("unclassified" as const),
            energyWh: session.energyWh,
            integrity: session.integrity,
            startedAt: session.startedAt,
            status: session.status,
            stoppedAt: session.stoppedAt,
            tagPseudonym: session.tagPseudonym,
            transactionId: session.transactionId,
          },
        ];
      })
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    return { sessions, stationId };
  });
  return {
    excludedPrivateSessions,
    generatedAt: now.toISOString(),
    month,
    schemaVersion: 1,
    stations,
    timeZone,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hasConnected(events: Events): boolean {
  return events.some(
    (event) => event.message === "Connected" || event.direction === "station-to-csms",
  );
}

async function respond(
  response: ServerResponse,
  run: () => Promise<readonly [number, unknown] | null>,
): Promise<void> {
  try {
    const result = await run();
    if (result) sendJson(response, result[0], result[1]);
  } catch (error) {
    if (!sendFleetError(response, error)) throw error;
  }
}

function sendFleetError(response: ServerResponse, error: unknown): boolean {
  const known: readonly [new (...args: never[]) => Error, number, string][] = [
    [StationRegistryInputError, 400, "invalid_station"],
    [StationRegistryConflictError, 409, "station_conflict"],
    [OwnerTagInputError, 400, "invalid_owner_tag"],
    [OwnerTagConflictError, 409, "owner_tag_conflict"],
    [CardPolicyInputError, 400, "invalid_card_policy"],
    [CardPolicyUnavailableError, 503, "card_policy_unavailable"],
    [CardCaptureUnavailableError, 409, "card_capture_unavailable"],
    [CardCaptureBusyError, 409, "card_capture_busy"],
    [UnknownStationError, 404, "station_not_found"],
  ];
  for (const [type, status, code] of known) {
    if (error instanceof type) {
      sendError(response, status, code, error.message);
      return true;
    }
  }
  if (error instanceof Error && error.name === "FreedomTestInputError") {
    sendError(response, 400, "invalid_request", error.message);
    return true;
  }
  if (error instanceof Error && error.name === "UsageInputError") {
    sendError(response, 400, "invalid_request", error.message);
    return true;
  }
  if (error instanceof Error && error.name === "DirectoryInputError") {
    sendError(response, 400, "invalid_station", error.message);
    return true;
  }
  if (error instanceof Error && error.name === "OwnerContinuityBlockedError") {
    sendError(response, 409, "continuity_not_ready", error.message);
    return true;
  }
  if (error instanceof Error && error.message.includes("is not connected")) {
    sendError(response, 409, "station_offline", "Charge point is not connected");
    return true;
  }
  return false;
}
