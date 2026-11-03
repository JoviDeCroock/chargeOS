import { describe, expect, it } from "vitest";

import { isRequestedBoot } from "../server/boot-evidence.js";
import type { EvidenceEvent } from "../server/events.js";
import { BOOT_REQUEST_DELAY_MS, createChargeGateway } from "../server/gateway.js";
import type { GatewayConfig } from "../server/config.js";

let sequence = 0;
function event(
  stationId: string,
  message: string,
  direction: EvidenceEvent["direction"] = "system",
  payload: unknown = {},
): EvidenceEvent {
  sequence += 1;
  return {
    at: new Date(Date.UTC(2026, 10, 3, 12, 0, sequence)).toISOString(),
    direction,
    eventId: `event-${sequence}`,
    message,
    payload,
    stationId,
  };
}
const request = (stationId: string) =>
  event(stationId, "TriggerMessage", "csms-to-station", { requestedMessage: "BootNotification" });
const boot = (stationId: string) => event(stationId, "BootNotification", "station-to-csms");
const lastIsRequested = (events: EvidenceEvent[]) => isRequestedBoot(events, events.length - 1);

describe("requested BootNotification evidence", () => {
  it("counts a Boot after a request on the same connection as requested, whatever the answer", () => {
    for (const answer of ["Accepted", "Rejected", "NotImplemented"]) {
      expect(
        lastIsRequested([
          event("A", "Connected"),
          request("A"),
          event("A", "TriggerMessageResult", "station-to-csms", { status: answer }),
          boot("A"),
        ]),
      ).toBe(true);
    }
    expect(
      lastIsRequested([
        event("A", "Connected"),
        request("A"),
        event("A", "TriggerMessageFailed", "system", { reason: "timeout" }),
        boot("A"),
      ]),
    ).toBe(true);
  });

  it("ignores other chargers' connections between the request and the Boot", () => {
    expect(
      lastIsRequested([
        event("A", "Connected"),
        request("A"),
        event("B", "Disconnected"),
        event("B", "Connected"),
        boot("A"),
      ]),
    ).toBe(true);
    expect(lastIsRequested([event("A", "Connected"), request("B"), boot("A")])).toBe(false);
  });

  it("treats a Boot on a new connection as the charger's own", () => {
    expect(
      lastIsRequested([event("A", "Connected"), request("A"), event("A", "Connected"), boot("A")]),
    ).toBe(false);
    // Even if the new Connected record is missing, the previous connection's end bounds the scan.
    expect(
      lastIsRequested([
        event("A", "Connected"),
        request("A"),
        event("A", "Disconnected"),
        boot("A"),
      ]),
    ).toBe(false);
    expect(lastIsRequested([boot("A")])).toBe(false);
  });

  it("ignores requests for other messages", () => {
    expect(
      lastIsRequested([
        event("A", "Connected"),
        event("A", "TriggerMessage", "csms-to-station", { requestedMessage: "StatusNotification" }),
        boot("A"),
      ]),
    ).toBe(false);
  });

  it("asks after 30 seconds by default and rejects an invalid delay", () => {
    expect(BOOT_REQUEST_DELAY_MS).toBe(30_000);
    const config = { stationId: "A", stationSecret: "x".repeat(40) } as unknown as GatewayConfig;
    const store = {
      allocateAuthorizationRevision: async () => 1,
      append: async () => undefined,
      readEvents: async () => [],
      recordTransactionStart: async () => ({ replayed: false, transactionId: 1 }),
    };
    for (const bootRequestDelayMs of [-1, 1.5, Number.NaN]) {
      expect(() => createChargeGateway(config, store, { bootRequestDelayMs })).toThrow(
        "bootRequestDelayMs",
      );
    }
  });
});
