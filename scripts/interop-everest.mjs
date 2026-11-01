#!/usr/bin/env node
// Software-in-the-loop interoperability drill against EVerest, an independent open-source charger
// stack (Linux Foundation Energy) whose libocpp runs in production chargers.
//
// It runs a real chargeOS edge from this checkout and points EVerest's OCPP 1.6J charge point at it,
// then exercises the owner workflow end to end, including backend loss, offline charging, a charger
// restart while offline, and transaction replay. Everything runs on throwaway synthetic credentials
// in a private temporary directory.
//
// This is NOT evidence that any physical charger works. It proves only that chargeOS and one
// independent OCPP implementation agree. The release gate remains the witnessed Freedom Test.

import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** EVerest demo 2025.10.0 (everest-core c86cd9c, libocpp v0.30.3), pinned by digest. */
export const EVEREST_IMAGES = Object.freeze({
  manager:
    "ghcr.io/everest/everest-demo/manager:2025.10.0-single-phase@sha256:9165d0937323ae61ee2e496f68f3c4a465ed9099740e489df1f0161265492756",
  mqtt: "ghcr.io/everest/everest-demo/mqtt-server:2025.10.0-single-phase@sha256:1aa72f12ef8556c38d630723c524036fa2f2f8e8115ea2abf4769b3eb7600096",
});
const EVEREST_OCPP_CONFIG = "/ext/dist/share/everest/modules/OCPP/config-docker.json";
const STATION_ID = "EVEREST_SIL_CP1";
/** The whole drill normally takes about five minutes after the image pull. */
const DRILL_DEADLINE_MS = 20 * 60_000;

const CONTINUITY_PREPARATION_PHRASE = "I authorize only the documented owner-continuity settings";
const STATION_RESET_PHRASE = "I understand this restarts the charger and may end a session";

const HELP = `Usage: pnpm interop:everest [--keep]

Run chargeOS against EVerest's OCPP 1.6J charge point (software in the loop, Docker required; the
EVerest image is about 16 GB). Steps: boot, inspection, owner-continuity preparation, card
synchronization, an online owner session, backend loss with an offline owner session and a refused
unknown card, replay, remote start/stop, a remote reset followed by a restart while chargeOS is
down, a second offline owner session and its replay.

  --keep   keep the temporary directory (ledger, edge log, generated EVerest config) afterwards

This proves agreement with one independent OCPP implementation. It is not evidence that any
physical charger works and never replaces the witnessed Freedom Test.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({
    options: { help: { type: "boolean" }, keep: { type: "boolean" } },
  });
  if (values.help) {
    console.log(HELP);
  } else {
    runDrill({ keep: Boolean(values.keep) }).then(
      (passed) => process.exit(passed ? 0 : 1),
      (error) => {
        console.error(`EVerest interoperability drill failed: ${error.message}`);
        process.exit(1);
      },
    );
  }
}

async function runDrill({ keep }) {
  await execFile("docker", ["version", "--format", "{{.Server.Version}}"]).catch(() => {
    throw new Error("Docker is required and must be running");
  });
  const directory = await mkdtemp(join(tmpdir(), "chargeos-everest-"));
  await chmod(directory, 0o700);
  const project = `chargeos-everest-${randomBytes(4).toString("hex")}`;
  const ocppPort = await freePort();
  const apiPort = await freePort();
  // Docker Desktop forwards host.docker.internal to the host's loopback. A Linux engine reaches
  // the host only through the bridge, so the throwaway edge must listen on every interface there.
  const ocppHost = process.platform === "linux" ? "0.0.0.0" : "127.0.0.1";
  const secrets = {
    apiToken: randomBytes(32).toString("hex"),
    ownerTag: `OWN${randomBytes(6).toString("hex").toUpperCase()}`,
    stationSecret: randomBytes(20).toString("hex"),
    unknownTag: `UNK${randomBytes(6).toString("hex").toUpperCase()}`,
  };
  const ledgerPath = join(directory, "events.ndjson");
  const edgeLogPath = join(directory, "edge.log");
  const envPath = join(directory, "chargeos.env");
  await writeFile(
    envPath,
    [
      `CHARGEOS_STATION_ID=${STATION_ID}`,
      `CHARGEOS_STATION_SECRET=${secrets.stationSecret}`,
      `CHARGEOS_OWNER_API_TOKEN=${secrets.apiToken}`,
      `CHARGEOS_OWNER_TAGS=${secrets.ownerTag}`,
      `CHARGEOS_OCPP_HOST=${ocppHost}`,
      `CHARGEOS_PORT=${ocppPort}`,
      "CHARGEOS_API_HOST=127.0.0.1",
      `CHARGEOS_API_PORT=${apiPort}`,
      `CHARGEOS_EVENT_LOG=${ledgerPath}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const steps = [];
  const step = async (name, action) => {
    const started = Date.now();
    process.stdout.write(`- ${name} ... `);
    try {
      const detail = await action();
      steps.push({ name, passed: true });
      console.log(
        `ok (${Math.round((Date.now() - started) / 1000)}s)${detail ? ` ${detail}` : ""}`,
      );
    } catch (error) {
      steps.push({ name, passed: false });
      console.log(`FAILED: ${error.message}`);
      throw error;
    }
  };

  const edge = createEdge(envPath, edgeLogPath);
  const api = createApi(apiPort, secrets.apiToken);
  const ledger = createLedger(ledgerPath);
  const compose = createCompose(directory, project);
  let passed = false;
  let deadline;
  try {
    console.log(`EVerest interoperability drill (${project})`);
    if (ocppHost === "0.0.0.0") {
      console.log(
        `  note: the throwaway edge accepts plaintext OCPP on every interface (port ${ocppPort}) for the drill's duration`,
      );
    }
    await step("pull the pinned EVerest images (first run downloads about 16 GB)", async () => {
      await execFile("docker", ["pull", "-q", EVEREST_IMAGES.mqtt], { maxBuffer: 1 << 24 });
      await execFile("docker", ["pull", "-q", EVEREST_IMAGES.manager], {
        maxBuffer: 1 << 24,
        timeout: 3_600_000,
      });
    });
    await Promise.race([
      drill(),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(`drill exceeded ${DRILL_DEADLINE_MS / 60_000} minutes`)),
          DRILL_DEADLINE_MS,
        );
      }),
    ]);
    passed = true;
  } finally {
    clearTimeout(deadline);
    await edge.stop().catch(() => undefined);
    await compose("down", "-v", "--remove-orphans").catch(() => undefined);
    if (keep || !passed) {
      console.log(`Kept ${directory} (synthetic throwaway credentials, owner-only).`);
    } else {
      await rm(directory, { force: true, recursive: true });
    }
  }
  console.log(
    `EVerest interoperability drill passed (${steps.length} steps). This shows agreement with one independent OCPP 1.6J implementation; it is not physical-charger or Freedom Test evidence.`,
  );
  return passed;

  async function drill() {
    await step("write EVerest's charge-point config for this edge", async () => {
      const { stdout } = await execFile("docker", [
        "run",
        "--rm",
        "--entrypoint",
        "cat",
        EVEREST_IMAGES.manager,
        EVEREST_OCPP_CONFIG,
      ]);
      const configuration = JSON.parse(stdout);
      configuration.Internal.ChargePointId = STATION_ID;
      configuration.Internal.ChargeBoxSerialNumber = STATION_ID;
      configuration.Internal.CentralSystemURI = `host.docker.internal:${ocppPort}/`;
      configuration.Security.AuthorizationKey = secrets.stationSecret;
      configuration.Security.SecurityProfile = 1;
      await writeFile(
        join(directory, "config-docker.json"),
        `${JSON.stringify(configuration, null, 2)}\n`,
        { mode: 0o600 },
      );
      await writeFile(join(directory, "compose.yaml"), composeFile(), { mode: 0o600 });
      const defaults = configuration.Core;
      return `(EVerest defaults: LocalAuthorizeOffline=${defaults.LocalAuthorizeOffline}, AllowOfflineTxForUnknownId=${"AllowOfflineTxForUnknownId" in defaults ? defaults.AllowOfflineTxForUnknownId : "absent"})`;
    });

    await step(
      "start chargeOS and EVerest; EVerest boots with a 40-hex Basic-auth password",
      async () => {
        await edge.start();
        await compose("up", "-d");
        await ledger.waitFor((event) => event.message === "BootNotification", 240_000);
        const boot = (await ledger.events()).find((event) => event.message === "BootNotification");
        return `(${boot.payload.chargePointVendor} ${boot.payload.chargePointModel} ${boot.payload.firmwareVersion})`;
      },
    );

    await step("inspect, prepare owner continuity and synchronize the owner card", async () => {
      const before = await api.post("/inspect");
      const prepared = await api.post("/prepare-owner-continuity", {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      });
      assert(prepared.state === "ready", `preparation ended ${prepared.state}`);
      const sync = await api.post("/sync-authorizations");
      assert(sync.status === "Accepted", `local list ${sync.status}`);
      return `(before: ${before.state}; changed ${prepared.changes.map(({ key }) => key).join(", ") || "nothing"}; list v${sync.listVersion})`;
    });
    const tagPseudonym = (await api.snapshot()).authorization.tagPseudonyms[0];

    await step("online owner session", async () => {
      await compose.charge(1, 8);
      await compose.card(secrets.ownerTag);
      const session = await waitForSession(api, (s) => s.status === "complete", 1);
      return `(#${session.transactionId}, ${session.energyWh} Wh)`;
    });

    const offlineFrom = new Date().toISOString();
    await step("backend loss: owner card charges offline, unknown card is refused", async () => {
      await edge.stop();
      await sleep(3_000);
      await compose.charge(1, 15);
      await compose.card(secrets.ownerTag);
      await sleep(3_000);
      const rejectedBefore = await compose.countLog(/REJECTED/u);
      await compose.charge(2, 4);
      await compose.card(secrets.unknownTag);
      await waitUntil(
        async () => (await compose.countLog(/REJECTED/u)) > rejectedBefore,
        30_000,
        "EVerest to refuse the unknown card",
      );
      await sleep(18_000);
    });

    await step("chargeOS returns; EVerest replays the offline session", async () => {
      await edge.start();
      const session = await waitForSession(
        api,
        (s) => s.status === "complete" && s.startedAt > offlineFrom,
        2,
        360_000,
      );
      assert(session.authorizationStatus === "Accepted", "offline session not accepted");
      assert(session.tagPseudonym === tagPseudonym, "offline session used a different card");
      const sessions = (await api.snapshot()).sessions;
      assert(
        !sessions.some((s) => s.connectorId === 2),
        "a session was recorded for the refused unknown card",
      );
      return `(#${session.transactionId} started offline at ${session.startedAt}, ${session.energyWh} Wh)`;
    });

    await step("remote start and remote stop", async () => {
      await compose.charge(1, 60);
      const start = await api.post("/commands", {
        connectorId: 1,
        tagPseudonym,
        type: "RemoteStartTransaction",
      });
      assert(start.command.state === "accepted", `remote start ${start.command.status}`);
      const active = await waitForSession(api, (s) => s.status === "active", 3);
      const stop = await api.post("/commands", {
        transactionId: active.transactionId,
        type: "RemoteStopTransaction",
      });
      assert(stop.command.state === "accepted", `remote stop ${stop.command.status}`);
      await waitForSession(
        api,
        (s) => s.transactionId === active.transactionId && s.status === "complete",
        3,
      );
      await waitUntil(
        async () =>
          (await api.snapshot()).commands
            .filter((c) => c.type.startsWith("Remote"))
            .every((c) => c.observed),
        30_000,
        "both remote commands to be observed",
      );
    });

    const rebootFrom = new Date().toISOString();
    await step("remote reset, then the charger restarts while chargeOS is down", async () => {
      const reset = await api.post("/commands", {
        confirmation: STATION_RESET_PHRASE,
        resetType: "Soft",
        type: "Reset",
      });
      assert(reset.command.state === "accepted", `reset ${reset.command.status}`);
      await ledger.waitFor(
        (event) => event.message === "Disconnected" && event.at > rebootFrom,
        60_000,
      );
      await edge.stop();
      // EVerest's software-in-the-loop manager exits on reset; a real charger's supervisor restarts
      // it. Starting it again here plays that role.
      await compose.waitForManagerExit();
      const startedBefore = await compose.countLog(/OCPP started/u);
      await compose("start", "manager");
      await waitUntil(
        async () => (await compose.countLog(/OCPP started/u)) > startedBefore,
        180_000,
        "EVerest to restart",
      );
      await sleep(5_000);
      await compose.charge(1, 8);
      await compose.card(secrets.ownerTag);
      await sleep(14_000);
    });

    await step("chargeOS returns; boot, replay and reset are reconciled", async () => {
      await edge.start();
      const session = await waitForSession(
        api,
        (s) => s.status === "complete" && s.startedAt > rebootFrom,
        4,
        360_000,
      );
      const snapshot = await api.snapshot();
      const reset = snapshot.commands.find((c) => c.type === "Reset");
      assert(reset?.observed?.startsWith("Charger restarted"), "reset not observed");
      const inspection = await api.post("/inspect");
      assert(inspection.state === "ready", `post-restart inspection ${inspection.state}`);
      assert(inspection.localListVersion >= 1, "local list lost across restart");
      return `(#${session.transactionId}; settings and list v${inspection.localListVersion} survived)`;
    });

    await step("every session is consistent and no raw card value was written", async () => {
      const { sessions } = await api.snapshot();
      assert(sessions.length === 4, `expected 4 sessions, found ${sessions.length}`);
      for (const session of sessions) {
        assert(
          session.status === "complete" && session.integrity === "consistent",
          `session #${session.transactionId} is ${session.status}/${session.integrity}`,
        );
      }
      const written = `${await readFile(ledgerPath, "utf8")}\n${await readFile(edgeLogPath, "utf8")}`;
      for (const value of [secrets.ownerTag, secrets.unknownTag, secrets.stationSecret]) {
        assert(!written.toUpperCase().includes(value.toUpperCase()), "a raw secret was written");
      }
    });
  }
}

function composeFile() {
  return `services:
  mqtt-server:
    image: ${EVEREST_IMAGES.mqtt}
  manager:
    image: ${EVEREST_IMAGES.manager}
    depends_on: [mqtt-server]
    environment: [MQTT_SERVER_ADDRESS=mqtt-server]
    entrypoint: "sh /ext/build/run-scripts/run-sil-ocpp.sh"
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes:
      - ./config-docker.json:${EVEREST_OCPP_CONFIG}:ro
`;
}

function createCompose(directory, project) {
  const base = ["compose", "-p", project, "-f", join(directory, "compose.yaml")];
  const run = async (...args) => {
    try {
      const { stdout } = await execFile("docker", [...base, ...args], {
        cwd: directory,
        maxBuffer: 1 << 26,
        timeout: 600_000,
      });
      return stdout;
    } catch (error) {
      // Report the subcommand only; never echo the full command line or its output.
      throw new Error(`docker compose ${args[0]} failed (exit ${error.code ?? "unknown"})`);
    }
  };
  // Messages (including synthetic card values) go through stdin, never argv, so they do not appear
  // in process listings or error messages.
  const publish = (topic, message) =>
    new Promise((resolvePublish, reject) => {
      const child = spawn(
        "docker",
        [...base, "exec", "-T", "mqtt-server", "mosquitto_pub", "-t", topic, "-s"],
        { cwd: directory, stdio: ["pipe", "ignore", "ignore"] },
      );
      child.once("error", () => reject(new Error("docker compose exec failed to start")));
      child.once("exit", (code) =>
        code === 0
          ? resolvePublish()
          : reject(new Error(`MQTT publish to ${topic} failed (exit ${code})`)),
      );
      child.stdin.end(message);
    });
  run.countLog = async (pattern) => {
    const logs = await run("logs", "--no-color", "manager");
    return logs.split("\n").filter((line) => pattern.test(line)).length;
  };
  run.charge = async (connectorId, seconds) => {
    const plugged = new RegExp(`evse_manager_${connectorId}:.*Session Started`, "u");
    const before = await run.countLog(plugged);
    await publish(
      `everest_external/nodered/${connectorId}/carsim/cmd/execute_charging_session`,
      `sleep 1;iec_wait_pwr_ready;sleep 1;draw_power_regulated 16,3;sleep ${seconds};unplug`,
    );
    // Present a card only once the simulated car is plugged in. A card that arrived first was
    // refused, and EVerest's software-in-the-loop setup was then seen to stall.
    await waitUntil(
      async () => (await run.countLog(plugged)) > before,
      30_000,
      `the simulated car to plug into connector ${connectorId}`,
    );
  };
  run.card = (value) =>
    publish(
      "everest_api/dummy_token_provider/cmd/provide",
      JSON.stringify({ authorization_type: "RFID", id_token: { type: "ISO14443", value } }),
    );
  run.waitForManagerExit = () =>
    waitUntil(
      async () => !(await run("ps", "--status", "running", "--services")).includes("manager"),
      60_000,
      "EVerest to stop after reset",
    );
  return run;
}

function createEdge(envPath, logPath) {
  let child = null;
  return {
    async start() {
      if (child) return;
      const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
      // Never inherit the operator's own chargeOS settings: a CHARGEOS_* variable already in the
      // environment would win over the throwaway env file and could point at a real ledger.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("CHARGEOS_")),
      );
      child = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
        cwd: ROOT,
        env: { ...env, CHARGEOS_ENV_FILE: envPath },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const capture = (chunk) => {
        output += chunk;
        log.write(chunk);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const current = child;
      await waitUntil(
        async () => {
          if (current.exitCode !== null) throw new Error("chargeOS edge exited during startup");
          return output.includes("owner UI/API listening");
        },
        60_000,
        "the chargeOS edge to start",
      );
    },
    async stop() {
      if (!child) return;
      const current = child;
      child = null;
      if (current.exitCode !== null) return;
      const exited = new Promise((resolveExit) => current.once("exit", resolveExit));
      current.kill("SIGTERM");
      await Promise.race([exited, sleep(10_000).then(() => current.kill("SIGKILL"))]);
      await exited;
    },
  };
}

function createApi(port, token) {
  const base = `http://127.0.0.1:${port}`;
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${payload.error?.message ?? ""}`);
    }
    return payload;
  };
  return {
    post: (suffix, body) => request("POST", `/api/v1/stations/${STATION_ID}${suffix}`, body),
    snapshot: () => request("GET", "/api/v1/snapshot"),
  };
}

function createLedger(path) {
  const events = async () => {
    if (!existsSync(path)) return [];
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  return {
    events,
    waitFor: (predicate, timeoutMs) =>
      waitUntil(
        async () => (await events()).some(predicate),
        timeoutMs,
        "the expected charger message",
      ),
  };
}

async function waitForSession(api, predicate, count, timeoutMs = 120_000) {
  let found = null;
  await waitUntil(
    async () => {
      const sessions = (await api.snapshot().catch(() => ({ sessions: [] }))).sessions;
      found = sessions.length >= count ? (sessions.find(predicate) ?? null) : null;
      return found !== null;
    },
    timeoutMs,
    `session ${count}`,
  );
  return found;
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1_000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}
