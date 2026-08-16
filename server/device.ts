import type { FreedomTestDeviceIdentity, FreedomTestDeviceInput } from "../shared/freedom-test.js";
import type { EvidenceEvent } from "./events.js";

export interface StoredDeviceInventory extends FreedomTestDeviceInput {
  readonly connectivity: FreedomTestDeviceIdentity["connectivity"];
  readonly countryCode: string;
  readonly inventorySchemaVersion: 2;
  readonly recordedAt: string;
}

export function buildDeviceIdentity(
  events: readonly EvidenceEvent[],
  bootEvent: EvidenceEvent | null | undefined = events.findLast(
    (event) => event.message === "BootNotification",
  ),
): FreedomTestDeviceIdentity | null {
  const inventoryEvent = events.findLast((event) => event.message === "FreedomTestDeviceRecorded");
  const inventory = parseDeviceInventory(inventoryEvent?.payload);
  if (!inventory) return null;

  const boot = payloadRecord(bootEvent);
  const observedVendor = typeof boot.chargePointVendor === "string" ? boot.chargePointVendor : null;
  const observedModel = typeof boot.chargePointModel === "string" ? boot.chargePointModel : null;
  const observedFirmwareVersion =
    typeof boot.firmwareVersion === "string" ? boot.firmwareVersion : null;
  const identityMatch: FreedomTestDeviceIdentity["identityMatch"] = !bootEvent
    ? "pending"
    : observedVendor === inventory.inventoryVendor &&
        observedModel === inventory.inventoryModel &&
        observedFirmwareVersion === inventory.inventoryFirmwareVersion
      ? "match"
      : "mismatch";

  return {
    articleNumber: inventory.articleNumber,
    bootObservedAt: bootEvent?.at ?? null,
    configurationPath: inventory.configurationPath,
    connectivity: inventory.connectivity,
    countryCode: inventory.countryCode,
    firmwareVersion: observedFirmwareVersion,
    hardwareRevision: inventory.hardwareRevision,
    identityMatch,
    inventoryEvidenceSha256: inventory.evidenceSha256,
    inventoryFirmwareVersion: inventory.inventoryFirmwareVersion,
    inventoryModel: inventory.inventoryModel,
    inventoryVendor: inventory.inventoryVendor,
    model: observedModel,
    priorOperator: inventory.priorOperator,
    recordedAt: inventory.recordedAt,
    vendor: observedVendor,
  };
}

export function latestDeviceInventoryEvent(
  events: readonly EvidenceEvent[],
): EvidenceEvent | undefined {
  return events.findLast((event) => event.message === "FreedomTestDeviceRecorded");
}

function parseDeviceInventory(value: unknown): StoredDeviceInventory | null {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (
    payload.inventorySchemaVersion !== 2 ||
    typeof payload.articleNumber !== "string" ||
    typeof payload.configurationPath !== "string" ||
    !["ethernet", "wifi", "cellular", "mixed", "other"].includes(String(payload.connectivity)) ||
    typeof payload.countryCode !== "string" ||
    typeof payload.evidenceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.evidenceSha256) ||
    typeof payload.hardwareRevision !== "string" ||
    typeof payload.inventoryFirmwareVersion !== "string" ||
    typeof payload.inventoryModel !== "string" ||
    typeof payload.inventoryVendor !== "string" ||
    typeof payload.priorOperator !== "string" ||
    typeof payload.recordedAt !== "string"
  ) {
    return null;
  }
  return payload as unknown as StoredDeviceInventory;
}

function payloadRecord(event: EvidenceEvent | null | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}
