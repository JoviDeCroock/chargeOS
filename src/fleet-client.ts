import type {
  AddStationInput,
  AddStationResult,
  CardReference,
  DelegateGrantCreated,
  DelegateGrantInput,
  DelegateGrantSummary,
  DriverView,
  FleetCardActionResult,
  FleetCardsProjection,
  StationOwnership,
  StationRegistryProjection,
  SyncReadyResult,
} from "../shared/contracts.js";
import type { CardOwnership, CardUse } from "../shared/cards.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import { postJson, requestJson, stationPath } from "./api.js";

export function fetchStationRegistry(token: string): Promise<StationRegistryProjection> {
  return requestJson("/api/v1/stations-registry", token);
}

export function addStation(input: AddStationInput, token: string): Promise<AddStationResult> {
  return postJson("/api/v1/managed-stations", token, input);
}

export function retireStation(
  stationId: string,
  confirmation: string,
  token: string,
): Promise<StationRegistryProjection> {
  return postJson(stationPath(stationId, "/retire"), token, { confirmation });
}

export function reissueStationPassword(
  stationId: string,
  token: string,
): Promise<AddStationResult> {
  return postJson(stationPath(stationId, "/reissue-password"), token, {});
}

export function setStationOwnership(
  stationId: string,
  ownership: StationOwnership,
  token: string,
): Promise<StationRegistryProjection> {
  return postJson(stationPath(stationId, "/ownership"), token, { ownership });
}

/** The server accepts exactly these two keys; callers often hold a richer card member. */
function reference({ stationId, tagPseudonym }: CardReference): CardReference {
  return { stationId, tagPseudonym };
}

export function fetchFleetCards(token: string): Promise<FleetCardsProjection> {
  return requestJson("/api/v1/fleet-cards", token);
}

export function copyFleetCard(
  card: CardReference,
  toStationIds: readonly string[],
  token: string,
): Promise<FleetCardActionResult> {
  return postJson("/api/v1/fleet-cards/copy", token, { card: reference(card), toStationIds });
}

export function removeFleetCard(
  card: CardReference,
  token: string,
): Promise<FleetCardActionResult> {
  return postJson("/api/v1/fleet-cards/remove", token, {
    card: reference(card),
    confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
  });
}

export function setFleetCardPolicy(
  card: CardReference,
  ownership: CardOwnership,
  use: CardUse,
  token: string,
): Promise<FleetCardsProjection> {
  return postJson("/api/v1/fleet-cards/policy", token, { card: reference(card), ownership, use });
}

export function syncReadyChargers(token: string): Promise<SyncReadyResult> {
  return postJson("/api/v1/sync-ready", token, {});
}

/** Grants on the first charger cover fleet roles (the finance feed). */
export function fetchFleetDelegations(token: string): Promise<readonly DelegateGrantSummary[]> {
  return requestJson("/api/v1/delegations", token);
}

export function createStationDelegation(
  stationId: string | null,
  input: DelegateGrantInput,
  token: string,
): Promise<DelegateGrantCreated> {
  return postJson(
    stationId ? stationPath(stationId, "/delegations") : "/api/v1/delegations",
    token,
    input,
  );
}

export function fetchStationDelegations(
  stationId: string,
  token: string,
): Promise<readonly DelegateGrantSummary[]> {
  return requestJson(stationPath(stationId, "/delegations"), token);
}

export function revokeStationDelegation(
  stationId: string | null,
  grantId: string,
  token: string,
): Promise<DelegateGrantSummary> {
  const path = `/delegations/${encodeURIComponent(grantId)}/revoke`;
  return postJson(stationId ? stationPath(stationId, path) : `/api/v1${path}`, token, {});
}

/* Employee page: the same API, authenticated with the employee's own delegate token. */

export function fetchDriverView(stationId: string, token: string): Promise<DriverView> {
  return requestJson(stationPath(stationId, "/delegate/driver"), token);
}

export function driverArmCapture(stationId: string, token: string): Promise<DriverView> {
  return postJson(stationPath(stationId, "/delegate/driver/card-capture"), token, {});
}

export function driverCancelCapture(stationId: string, token: string): Promise<DriverView> {
  return postJson(stationPath(stationId, "/delegate/driver/card-capture/cancel"), token, {});
}

export function driverConfirmCapture(
  stationId: string,
  tagPseudonym: string,
  token: string,
): Promise<DriverView> {
  return postJson(stationPath(stationId, "/delegate/driver/card-capture/confirm"), token, {
    tagPseudonym,
  });
}

export function driverRemoveCard(
  stationId: string,
  tagPseudonym: string,
  token: string,
): Promise<DriverView> {
  return postJson(
    stationPath(stationId, `/delegate/driver/cards/${encodeURIComponent(tagPseudonym)}/remove`),
    token,
    { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
  );
}

export function driverSync(stationId: string, token: string): Promise<DriverView> {
  return postJson(stationPath(stationId, "/delegate/driver/sync"), token, {});
}
