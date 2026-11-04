import type { ConnectorStatus, OwnerSnapshot } from "./contracts.js";

type StationConnection = Pick<OwnerSnapshot["station"], "connected" | "connectedAt" | "connectors">;

const NON_CHARGING_STATUSES = new Set([
  "Available",
  "Preparing",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
]);

export type ReportedChargingStatus = "charging" | "idle" | "unknown";

export function currentChargingReport(station: StationConnection): {
  readonly status: ReportedChargingStatus;
  readonly connectors: readonly ConnectorStatus[];
} {
  if (!station.connected || !station.connectedAt) return { status: "unknown", connectors: [] };
  const connectedAt = Date.parse(station.connectedAt);
  const connectors = station.connectors.filter(({ connectorId }) => connectorId > 0);
  const current = connectors.filter(({ updatedAt }) => Date.parse(updatedAt) >= connectedAt);
  const charging = current.filter(({ status }) => status === "Charging");
  if (charging.length) return { status: "charging", connectors: charging };
  if (
    current.length &&
    current.length === connectors.length &&
    current.every(({ status }) => NON_CHARGING_STATUSES.has(status))
  ) {
    return { status: "idle", connectors: current };
  }
  return { status: "unknown", connectors: [] };
}
