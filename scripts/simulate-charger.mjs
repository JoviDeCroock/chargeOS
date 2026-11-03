#!/usr/bin/env node
// Synthetic OCPP 1.6J charge point for local development, demos and contributor testing.
//
// It is NOT a model of any real charger. Profiles are named after a protocol behavior, never a
// brand, and a profile working against chargeOS is not evidence that any device works. The
// simulator never prints the owner tag or the station password.

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { RPCClient } from "ocpp-rpc";

const SAFE_CONFIGURATION = Object.freeze({
  AllowOfflineTxForUnknownId: "false",
  AuthorizationCacheEnabled: "false",
  LocalAuthListEnabled: "true",
  LocalAuthListMaxLength: "100",
  LocalAuthorizeOffline: "true",
  SendLocalListMaxLength: "100",
  TransactionMessageAttempts: "3",
  TransactionMessageRetryInterval: "30",
});

const UNSAFE_OFFLINE_SETTINGS = Object.freeze({
  AllowOfflineTxForUnknownId: "true",
  LocalAuthListEnabled: "false",
  LocalAuthorizeOffline: "false",
});

/** Behavior profiles. Each one reproduces a protocol difference seen across implementations. */
export const PROFILES = Object.freeze({
  conformant: {
    description: "Reports every local-list setting safely and accepts full list updates.",
    configuration: SAFE_CONFIGURATION,
    readonlyKeys: [],
  },
  "unsafe-defaults": {
    description:
      "Ships with offline local authorization off and unknown cards allowed offline; settings are writable so owner continuity preparation can fix them.",
    configuration: { ...SAFE_CONFIGURATION, ...UNSAFE_OFFLINE_SETTINGS },
    readonlyKeys: [],
  },
  "read-only-settings": {
    description:
      "Same unsafe defaults, but reports them read-only. chargeOS must refuse to prepare or synchronize.",
    configuration: { ...SAFE_CONFIGURATION, ...UNSAFE_OFFLINE_SETTINGS },
    readonlyKeys: Object.keys(UNSAFE_OFFLINE_SETTINGS),
  },
  "upper-case-uid": {
    description: "Reports card identifiers in upper case. OCPP identifiers are case-insensitive.",
    configuration: SAFE_CONFIGURATION,
    presentTag: (tag) => tag.toUpperCase(),
    readonlyKeys: [],
  },
  "vendor-messages": {
    description:
      "Sends a private DataTransfer, firmware status and a security event after boot, and spells booleans in upper case.",
    configuration: Object.fromEntries(
      Object.entries(SAFE_CONFIGURATION).map(([key, value]) => [
        key,
        value === "true" ? "TRUE" : value === "false" ? "FALSE" : value,
      ]),
    ),
    readonlyKeys: [],
    vendorMessages: true,
  },
  "unknown-offline-unsupported": {
    description:
      "Does not implement Unknown Offline Authorization, so it reports AllowOfflineTxForUnknownId as an unknown key (OCPP 1.6 section 9.1.1), and ships with offline local authorization off.",
    configuration: Object.fromEntries(
      Object.entries({ ...SAFE_CONFIGURATION, LocalAuthorizeOffline: "false" }).filter(
        ([key]) => key !== "AllowOfflineTxForUnknownId",
      ),
    ),
    readonlyKeys: [],
  },
  "trigger-unsupported": {
    description:
      "Answers TriggerMessage with NotImplemented, so it reports its identity only after a restart.",
    configuration: SAFE_CONFIGURATION,
    readonlyKeys: [],
    triggerUnsupported: true,
  },
  "local-list-unsupported": {
    description:
      "Has no local authorization list. chargeOS must report the gap and keep synchronization blocked.",
    configuration: Object.fromEntries(
      Object.entries(SAFE_CONFIGURATION).filter(
        ([key]) => !["LocalAuthListEnabled", "LocalAuthListMaxLength"].includes(key),
      ),
    ),
    readonlyKeys: [],
    rejectLocalList: true,
  },
});

/**
 * Create a simulated charge point. Nothing connects until `connect()` is called.
 *
 * @param {{
 *   endpoint: string,
 *   identity: string,
 *   password: string,
 *   profile?: keyof typeof PROFILES,
 *   boot?: { vendor?: string, model?: string, firmwareVersion?: string },
 *   log?: (line: string) => void,
 * }} options
 */
export function createSimulatedCharger(options) {
  const profileName = options.profile ?? "conformant";
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile ${profileName}`);
  const log = options.log ?? (() => undefined);
  const configuration = new Map(Object.entries(profile.configuration));
  const readonlyKeys = new Set(profile.readonlyKeys);
  let localListVersion = 0;
  let localListSize = 0;
  let meterWh = 1_000_000;
  /** @type {Map<number, { connectorId: number, idTag: string, meterStart: number }>} */
  const activeSessions = new Map();

  const client = new RPCClient({
    callTimeoutMs: 10_000,
    endpoint: options.endpoint,
    identity: options.identity,
    password: options.password,
    protocols: ["ocpp1.6"],
    reconnect: false,
    strictMode: true,
  });

  client.handle("GetConfiguration", async ({ params }) => {
    const requested = Array.isArray(params?.key) && params.key.length ? params.key : null;
    const keys = requested ?? [...configuration.keys()];
    log(`<- GetConfiguration (${keys.length} keys)`);
    return {
      configurationKey: keys
        .filter((key) => configuration.has(key))
        .map((key) => ({ key, readonly: readonlyKeys.has(key), value: configuration.get(key) })),
      ...(requested ? { unknownKey: requested.filter((key) => !configuration.has(key)) } : {}),
    };
  });

  client.handle("ChangeConfiguration", async ({ params }) => {
    const { key, value } = params;
    let status = "Accepted";
    if (!configuration.has(key)) status = "NotSupported";
    else if (readonlyKeys.has(key)) status = "Rejected";
    else configuration.set(key, value);
    log(`<- ChangeConfiguration ${key}=${value} -> ${status}`);
    return { status };
  });

  client.handle("GetLocalListVersion", async () => {
    log(`<- GetLocalListVersion -> ${profile.rejectLocalList ? -1 : localListVersion}`);
    return { listVersion: profile.rejectLocalList ? -1 : localListVersion };
  });

  client.handle("SendLocalList", async ({ params }) => {
    if (profile.rejectLocalList) {
      log("<- SendLocalList -> NotSupported");
      return { status: "NotSupported" };
    }
    const entries = Array.isArray(params.localAuthorizationList)
      ? params.localAuthorizationList
      : [];
    if (params.updateType === "Full") localListSize = entries.length;
    else localListSize += entries.length;
    localListVersion = params.listVersion;
    log(`<- SendLocalList v${localListVersion} (${localListSize} cards) -> Accepted`);
    return { status: "Accepted" };
  });

  client.handle("Reset", async ({ params }) => {
    log(`<- Reset ${params.type} -> Accepted (simulated restart: reconnect and BootNotification)`);
    setTimeout(() => {
      void (async () => {
        activeSessions.clear();
        await client.close({ code: 1000, reason: "Simulated restart" });
        await client.connect();
        log("reconnected after simulated restart");
        await boot();
      })().catch((error) => log(`simulated restart failed: ${error.message}`));
    }, 50);
    return { status: "Accepted" };
  });

  client.handle("RemoteStartTransaction", async ({ params }) => {
    const connectorId = params.connectorId ?? 1;
    const busy = [...activeSessions.values()].some(
      (session) => session.connectorId === connectorId,
    );
    log(`<- RemoteStartTransaction connector ${connectorId} -> ${busy ? "Rejected" : "Accepted"}`);
    if (busy) return { status: "Rejected" };
    setTimeout(() => {
      void startSession({ connectorId, tag: params.idTag, remote: true }).catch(() => undefined);
    }, 50);
    return { status: "Accepted" };
  });

  client.handle("RemoteStopTransaction", async ({ params }) => {
    const known = activeSessions.has(params.transactionId);
    log(`<- RemoteStopTransaction #${params.transactionId} -> ${known ? "Accepted" : "Rejected"}`);
    if (!known) return { status: "Rejected" };
    setTimeout(() => {
      void stopSession(params.transactionId, 2_500, "Remote").catch(() => undefined);
    }, 50);
    return { status: "Accepted" };
  });

  client.handle("UnlockConnector", async ({ params }) => {
    log(`<- UnlockConnector ${params.connectorId} -> Unlocked`);
    return { status: "Unlocked" };
  });

  client.handle("TriggerMessage", async ({ params }) => {
    const supported = !profile.triggerUnsupported && params.requestedMessage === "BootNotification";
    log(
      `<- TriggerMessage ${params.requestedMessage} -> ${supported ? "Accepted" : "NotImplemented"}`,
    );
    if (!supported) return { status: "NotImplemented" };
    // OCPP 1.6: answer first, then send the requested message on the same connection.
    setTimeout(() => {
      void boot().catch((error) => log(`requested BootNotification failed: ${error.message}`));
    }, 50);
    return { status: "Accepted" };
  });

  client.handle("ChangeAvailability", async ({ params }) => {
    log(`<- ChangeAvailability ${params.connectorId} ${params.type} -> Accepted`);
    if (params.type === "Operative") {
      setTimeout(() => {
        void status("Available", params.connectorId || 1).catch(() => undefined);
      }, 50);
    }
    return { status: "Accepted" };
  });

  async function boot() {
    const response = await client.call("BootNotification", {
      chargePointModel: options.boot?.model ?? "Simulator",
      chargePointVendor: options.boot?.vendor ?? "chargeOS-sim",
      firmwareVersion: options.boot?.firmwareVersion ?? "0.0.0-sim",
    });
    log(`-> BootNotification -> ${response.status}`);
    await status("Available");
    if (profile.vendorMessages) {
      const transfer = await client.call("DataTransfer", {
        data: "simulated-private-payload",
        messageId: "SimulatorInfo",
        vendorId: "dev.chargeos.simulator",
      });
      log(`-> DataTransfer -> ${transfer.status}`);
      await client.call("FirmwareStatusNotification", { status: "Idle" });
      log("-> FirmwareStatusNotification Idle");
      await client.call("SecurityEventNotification", {
        techInfo: "simulated technical detail",
        timestamp: new Date().toISOString(),
        type: "StartupOfTheDevice",
      });
      log("-> SecurityEventNotification StartupOfTheDevice");
    }
    return response;
  }

  async function status(value, connectorId = 1) {
    await client.call("StatusNotification", {
      connectorId,
      errorCode: "NoError",
      status: value,
      timestamp: new Date().toISOString(),
    });
    log(`-> StatusNotification connector ${connectorId} ${value}`);
  }

  /**
   * Start a charge session and leave it running. The tag is presented as the profile dictates
   * (remote starts use the identifier chargeOS sent) and is never logged.
   *
   * @param {{ tag: string, connectorId?: number, remote?: boolean }} session
   */
  async function startSession(session) {
    const connectorId = session.connectorId ?? 1;
    const presented =
      !session.remote && profile.presentTag ? profile.presentTag(session.tag) : session.tag;
    if (!session.remote) {
      const authorize = await client.call("Authorize", { idTag: presented });
      log(`-> Authorize (owner card) -> ${authorize.idTagInfo.status}`);
      if (authorize.idTagInfo.status !== "Accepted") {
        return { authorization: authorize.idTagInfo.status, transactionId: null };
      }
    }
    await status("Preparing", connectorId);
    const meterStart = meterWh;
    const start = await client.call("StartTransaction", {
      connectorId,
      idTag: presented,
      meterStart,
      timestamp: new Date().toISOString(),
    });
    log(`-> StartTransaction -> #${start.transactionId} ${start.idTagInfo.status}`);
    if (start.idTagInfo.status !== "Accepted") {
      await status("Available", connectorId);
      return { authorization: start.idTagInfo.status, transactionId: start.transactionId };
    }
    activeSessions.set(start.transactionId, { connectorId, idTag: presented, meterStart });
    await status("Charging", connectorId);
    return { authorization: "Accepted", transactionId: start.transactionId };
  }

  /**
   * Deliver energy for an active session and stop it.
   *
   * @param {number} transactionId
   * @param {number} energyWh
   * @param {string} reason
   * @param {number} samples
   */
  async function stopSession(transactionId, energyWh, reason = "Local", samples = 3) {
    const session = activeSessions.get(transactionId);
    if (!session) throw new Error(`Session #${transactionId} is not active`);
    activeSessions.delete(transactionId);
    for (let sample = 1; sample <= samples; sample += 1) {
      meterWh = session.meterStart + Math.round((energyWh * sample) / samples);
      await client.call("MeterValues", {
        connectorId: session.connectorId,
        meterValue: [
          {
            sampledValue: [
              { measurand: "Energy.Active.Import.Register", unit: "Wh", value: String(meterWh) },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
        transactionId,
      });
      log(`-> MeterValues ${meterWh} Wh`);
    }
    await client.call("StopTransaction", {
      idTag: session.idTag,
      meterStop: meterWh,
      reason,
      timestamp: new Date().toISOString(),
      transactionId,
    });
    log(`-> StopTransaction #${transactionId} (${energyWh} Wh)`);
    await status("Finishing", session.connectorId);
    await status("Available", session.connectorId);
  }

  /**
   * Run one complete local charge session.
   *
   * @param {{ tag: string, energyWh?: number, samples?: number }} session
   */
  async function runSession(session) {
    const started = await startSession({ tag: session.tag });
    if (started.authorization !== "Accepted" || started.transactionId === null) return started;
    await stopSession(
      started.transactionId,
      session.energyWh ?? 7_400,
      "Local",
      Math.max(1, session.samples ?? 3),
    );
    return started;
  }

  return {
    get activeTransactionIds() {
      return [...activeSessions.keys()];
    },
    boot,
    client,
    configuration,
    async close() {
      await client.close({ force: true });
    },
    async connect() {
      await client.connect();
      log(`connected to ${options.endpoint} as ${options.identity} (profile ${profileName})`);
    },
    get localListSize() {
      return localListSize;
    },
    get localListVersion() {
      return localListVersion;
    },
    runSession,
    startSession,
    status,
    stopSession,
  };
}

const HELP = `Usage: pnpm simulate [options]

Connect a synthetic OCPP 1.6J charge point to a local chargeOS edge (for example one started with
"pnpm dev"). It answers configuration, local-list, remote start/stop, reset, unlock and availability
commands, and can run a charge session.
It is a development tool: it proves nothing about any real charger.

Options:
  --env-file <path>       Read CHARGEOS_* settings from this file (default: .env if present)
  --endpoint <url>        OCPP endpoint (default: ws://127.0.0.1:$CHARGEOS_PORT, port 9000)
  --identity <id>         Charge point identity (default: $CHARGEOS_STATION_ID)
  --password-file <path>  File holding the station password (default: $CHARGEOS_STATION_SECRET)
  --profile <name>        Behavior profile (default: conformant)
  --session               Run one owner-card charge session after boot
  --tag-file <path>       File holding the card to present (default: first $CHARGEOS_OWNER_TAGS)
  --energy-wh <n>         Energy delivered by --session (default: 7400)
  --vendor/--model/--firmware <text>  BootNotification identity
  --no-boot               Connect without sending BootNotification, like a charger that only
                          reconnected; chargeOS asks for it with TriggerMessage after a short wait
  --exit                  Disconnect after boot (and the session) instead of staying online
  --list-profiles         Show the available profiles
  --help                  Show this help

Card values and passwords are read from files or the environment so they stay out of shell history,
and they are never printed.`;

async function main() {
  const { values } = parseArgs({
    options: {
      endpoint: { type: "string" },
      "energy-wh": { type: "string" },
      "env-file": { type: "string" },
      exit: { type: "boolean", default: false },
      firmware: { type: "string" },
      help: { type: "boolean", default: false },
      identity: { type: "string" },
      "list-profiles": { type: "boolean", default: false },
      "no-boot": { type: "boolean", default: false },
      model: { type: "string" },
      "password-file": { type: "string" },
      profile: { type: "string", default: "conformant" },
      session: { type: "boolean", default: false },
      "tag-file": { type: "string" },
      vendor: { type: "string" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values["list-profiles"]) {
    for (const [name, profile] of Object.entries(PROFILES)) {
      console.log(`${name.padEnd(24)} ${profile.description}`);
    }
    return;
  }

  const envFile = values["env-file"] ?? (existsSync(".env") ? ".env" : null);
  if (envFile) process.loadEnvFile(envFile);
  if (!(values.profile in PROFILES)) {
    throw new Error(`Unknown profile "${values.profile}". Run with --list-profiles.`);
  }

  const identity = values.identity ?? process.env.CHARGEOS_STATION_ID;
  const password = values["password-file"]
    ? readSecretFile(values["password-file"])
    : process.env.CHARGEOS_STATION_SECRET;
  if (!identity || !password) {
    throw new Error(
      "Set CHARGEOS_STATION_ID and CHARGEOS_STATION_SECRET (for example in .env), or pass --identity and --password-file.",
    );
  }
  const endpoint = values.endpoint ?? `ws://127.0.0.1:${process.env.CHARGEOS_PORT ?? "9000"}`;
  const energyWh = values["energy-wh"] === undefined ? undefined : Number(values["energy-wh"]);
  if (energyWh !== undefined && !(Number.isSafeInteger(energyWh) && energyWh > 0)) {
    throw new Error("--energy-wh must be a positive whole number");
  }

  const charger = createSimulatedCharger({
    boot: {
      ...(values.firmware ? { firmwareVersion: values.firmware } : {}),
      ...(values.model ? { model: values.model } : {}),
      ...(values.vendor ? { vendor: values.vendor } : {}),
    },
    endpoint,
    identity,
    log: (line) => console.log(`[sim] ${line}`),
    password,
    profile: values.profile,
  });
  await charger.connect();
  if (!values["no-boot"]) await charger.boot();

  if (values.session) {
    const tag = values["tag-file"]
      ? readSecretFile(values["tag-file"])
      : process.env.CHARGEOS_OWNER_TAGS?.split(",")[0]?.trim();
    if (!tag) throw new Error("--session needs CHARGEOS_OWNER_TAGS or --tag-file");
    await charger.runSession({ tag, ...(energyWh ? { energyWh } : {}) });
  }

  if (values.exit) {
    await charger.close();
    return;
  }
  console.log("[sim] online; answering chargeOS commands. Press Ctrl+C to disconnect.");
  const heartbeat = setInterval(() => {
    charger.client.call("Heartbeat", {}).catch(() => undefined);
  }, 60_000);
  let stopping = false;
  charger.client.once("close", () => {
    clearInterval(heartbeat);
    console.log("[sim] disconnected");
    if (!stopping) process.exitCode = 1;
  });
  process.once("SIGINT", () => {
    stopping = true;
    clearInterval(heartbeat);
    void charger.close();
  });
}

function readSecretFile(path) {
  const value = readFileSync(path, "utf8").replace(/\r?\n$/u, "");
  if (!value || /[\r\n]/u.test(value)) throw new Error(`${path} must hold exactly one line`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`[sim] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
