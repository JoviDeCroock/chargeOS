import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { RPCClient } from "ocpp-rpc";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requestedRuntimeImage = process.env.CHARGEOS_RUNTIME_IMAGE?.trim();
if (
  requestedRuntimeImage &&
  !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u.test(requestedRuntimeImage)
) {
  throw new Error("CHARGEOS_RUNTIME_IMAGE must be an immutable lowercase sha256 image reference");
}
const runtimeImage = requestedRuntimeImage ?? "chargeos:local";
const composeFile = join(root, "compose.production.yaml");
const smokeOverrideFile = join(root, "compose.runtime-smoke.yaml");
const envFile = join(root, ".env.production.example");
const suffix = `${process.pid}-${Date.now()}`;
const projectName = `chargeos-smoke-${suffix}`;
const caddyName = `${projectName}-caddy`;
const recoveryContainerName = `${projectName}-recovery-edge`;
const secretDirectory = mkdtempSync(join(realpathSync("/tmp"), "chargeos-production-smoke-"));
const ownerToken = "owner-production-smoke-token-32chars";
const ownerTag = "owner-smoke-tag";
const secondOwnerTag = "second-owner-tag";
const unknownTag = "unknown-smoke-tag";
const stationSecret = "station-production-smoke-secret-32chars";
const stationId = "PRODUCTION_SMOKE";
const ownerDomain = "owner.localhost";
const ocppDomain = "ocpp.localhost";
const ownerAuthorization = `Bearer ${ownerToken}`;
const continuityPreparationPhrase = "I authorize only the documented owner-continuity settings";
const continuityRecoveryPassphrase = "synthetic-production-recovery-passphrase";
const evidenceArchiveConfirmation =
  "I confirm chargeOS is stopped and the matching continuity bundle is held separately";
const evidenceCompactionConfirmation =
  "I confirm the full source bundle remains separately held and the compacted ledger will be installed only into a new empty edge";
const preSwitchCheckpointIds = [
  "ownership-authority",
  "contractual-constraints",
  "local-admin-custody",
  "network-sim-custody",
  "installer-safety-plan",
  "configuration-backup",
  "transaction-export",
  "standalone-rollback",
  "owner-standalone-charge",
  "station-secret-preprovisioned",
  "continuity-restore-drill",
  "secure-transport-plan",
];

const secretPaths = {
  CHARGEOS_OWNER_API_TOKEN_PATH: join(secretDirectory, "owner-api-token"),
  CHARGEOS_OWNER_TAGS_PATH: join(secretDirectory, "owner-tags"),
  CHARGEOS_STATION_SECRET_PATH: join(secretDirectory, "station-secret"),
};
const composeEnvironment = {
  ...process.env,
  ...secretPaths,
  CHARGEOS_IMAGE: runtimeImage,
  CHARGEOS_STATION_ID: stationId,
};
const composeArguments = [
  "compose",
  "--project-name",
  projectName,
  "--project-directory",
  root,
  "--env-file",
  envFile,
  "--file",
  composeFile,
  "--file",
  smokeOverrideFile,
];

let client;
let caddyStarted = false;
let chargeosId;
let recoveryContainerId;

try {
  writeSecret(secretPaths.CHARGEOS_OWNER_API_TOKEN_PATH, ownerToken);
  writeSecret(secretPaths.CHARGEOS_OWNER_TAGS_PATH, ownerTag);
  writeSecret(secretPaths.CHARGEOS_STATION_SECRET_PATH, stationSecret);

  if (requestedRuntimeImage) {
    run("docker", ["pull", runtimeImage], { stdio: "inherit" });
  } else {
    run("docker", [...composeArguments, "build", "chargeos"], {
      env: composeEnvironment,
      stdio: "inherit",
    });
  }
  run("docker", [...composeArguments, "up", "--detach", "chargeos"], {
    env: composeEnvironment,
    stdio: "inherit",
  });

  chargeosId = run("docker", [...composeArguments, "ps", "--quiet", "chargeos"], {
    env: composeEnvironment,
  }).trim();
  assert(chargeosId, "production chargeOS container did not start");
  await waitForHealthyContainer(chargeosId);
  verifyChargeosContainer(chargeosId, runtimeImage);

  const rendered = JSON.parse(
    run("docker", [...composeArguments, "config", "--format", "json"], {
      env: composeEnvironment,
    }),
  );
  const caddyImage = rendered.services?.caddy?.image;
  assert(caddyImage, "resolved production model has no Caddy image");

  run("docker", [
    "run",
    "--detach",
    "--name",
    caddyName,
    "--network",
    "bridge",
    "--publish",
    "127.0.0.1::443",
    "--read-only",
    "--user",
    rendered.services.caddy.user,
    "--cap-drop",
    "ALL",
    "--cap-add",
    "NET_BIND_SERVICE",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--tmpfs",
    "/data:rw,noexec,nosuid,size=32m,uid=1000,gid=1000,mode=0700",
    "--tmpfs",
    "/config:rw,noexec,nosuid,size=8m,uid=1000,gid=1000,mode=0700",
    "--env",
    "CHARGEOS_ACME_EMAIL=owner@example.net",
    "--env",
    `CHARGEOS_OCPP_DOMAIN=${ocppDomain}`,
    "--env",
    `CHARGEOS_OWNER_DOMAIN=${ownerDomain}`,
    "--env",
    "CHARGEOS_OCPP_MAX_CONNECTIONS=8",
    "--volume",
    `${join(root, "deploy/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
    caddyImage,
  ]);
  caddyStarted = true;
  run("docker", ["network", "connect", `${projectName}_chargeos-internal`, caddyName]);
  verifyCaddyContainer();

  const tlsPort = Number.parseInt(
    run("docker", ["port", caddyName, "443/tcp"]).trim().split(":").at(-1),
    10,
  );
  assert(Number.isInteger(tlsPort), "could not resolve the synthetic Caddy TLS port");

  const health = await retry(() => httpsRequest(ownerDomain, tlsPort, "/api/v1/health"));
  assert(health.status === 200, `HTTPS health returned ${health.status}`);
  assert(health.headers["strict-transport-security"] === "max-age=31536000", "HSTS missing");
  assert(health.headers["content-security-policy"], "owner Content-Security-Policy missing");

  const inventory = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/freedom-test/device",
    ownerAuthorization,
    {
      articleNumber: "SYNTHETIC-ARTICLE",
      configurationPath: "Synthetic production runtime smoke",
      connectivity: "ethernet",
      countryCode: "BE",
      evidenceSha256: "d".repeat(64),
      hardwareRevision: "synthetic",
      inventoryFirmwareVersion: "synthetic",
      inventoryModel: "Production smoke",
      inventoryVendor: "chargeOS test",
      priorOperator: "Synthetic prior operator",
    },
  );
  assert(inventory.status === 200, `device inventory returned ${inventory.status}`);
  for (const [index, stepId] of preSwitchCheckpointIds.entries()) {
    const checkpoint = await httpsRequest(
      ownerDomain,
      tlsPort,
      `/api/v1/migration/checkpoints/${stepId}`,
      ownerAuthorization,
      {
        evidenceSha256: (index + 1).toString(16).padStart(64, "0"),
        observedAt: new Date().toISOString(),
        outcome: "confirmed",
      },
    );
    assert(checkpoint.status === 200, `${stepId} checkpoint returned ${checkpoint.status}`);
  }
  // Host and Docker VM wall clocks can differ briefly. Timestamp this
  // synthetic manifest on its target runtime; keep the future-time gate strict.
  const targetCreatedAt = run("docker", [
    "exec",
    chargeosId,
    "node",
    "-p",
    "new Date().toISOString()",
  ]).trim();
  const targetManifest = syntheticMigrationTarget(targetCreatedAt);
  const targetManifestSha256 = createHash("sha256").update(targetManifest, "utf8").digest("hex");
  const migrationAuthorization = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/migration/authorize",
    ownerAuthorization,
    {
      confirmation: "I authorize the documented reversible endpoint change",
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      targetManifest,
      transport: "isolated-lan-ws",
    },
  );
  assert(
    migrationAuthorization.status === 200,
    `migration authorization returned ${migrationAuthorization.status}: ${migrationAuthorization.body}`,
  );
  const authorizedTargetManifestSha256 = JSON.parse(migrationAuthorization.body).authorization
    ?.targetManifestSha256;
  assert(
    authorizedTargetManifestSha256 === targetManifestSha256,
    `migration authorization persisted ${authorizedTargetManifestSha256}, expected canonical ${targetManifestSha256}`,
  );

  client = createSyntheticClient(tlsPort);
  await client.connect();

  const boot = await client.call("BootNotification", {
    chargePointModel: "Production smoke",
    chargePointVendor: "chargeOS test",
    firmwareVersion: "synthetic",
  });
  const heartbeat = await client.call("Heartbeat", {});
  await client.call("StatusNotification", {
    connectorId: 1,
    errorCode: "NoError",
    status: "Available",
    timestamp: new Date().toISOString(),
  });
  const preparation = await httpsRequest(
    ownerDomain,
    tlsPort,
    `/api/v1/stations/${stationId}/prepare-owner-continuity`,
    ownerAuthorization,
    { confirmation: continuityPreparationPhrase },
  );
  assert(preparation.status === 200, `continuity preparation returned ${preparation.status}`);
  const preparationResult = JSON.parse(preparation.body);
  assert(
    preparationResult.state === "ready" && preparationResult.changes?.length === 3,
    "continuity preparation did not verify all three one-way changes",
  );
  const inspection = await httpsRequest(
    ownerDomain,
    tlsPort,
    `/api/v1/stations/${stationId}/inspect`,
    ownerAuthorization,
    {},
  );
  assert(inspection.status === 200, `capability inspection returned ${inspection.status}`);
  assert(JSON.parse(inspection.body).state === "ready", "offline capabilities were not ready");
  const synchronization = await httpsRequest(
    ownerDomain,
    tlsPort,
    `/api/v1/stations/${stationId}/sync-authorizations`,
    ownerAuthorization,
    {},
  );
  assert(
    synchronization.status === 200,
    `owner authorization synchronization returned ${synchronization.status}`,
  );
  assert(
    JSON.parse(synchronization.body).status === "Accepted",
    "synthetic station did not accept the owner authorization list",
  );
  const addedOwnerTag = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/owner-tags",
    ownerAuthorization,
    { tag: secondOwnerTag },
  );
  assert(addedOwnerTag.status === 201, `owner tag add returned ${addedOwnerTag.status}`);
  assert(!addedOwnerTag.body.includes(secondOwnerTag), "owner tag add response exposed raw RFID");
  const secondSynchronization = await httpsRequest(
    ownerDomain,
    tlsPort,
    `/api/v1/stations/${stationId}/sync-authorizations`,
    ownerAuthorization,
    {},
  );
  assert(
    secondSynchronization.status === 200 &&
      JSON.parse(secondSynchronization.body).status === "Accepted",
    "updated durable owner authorization list was not accepted",
  );
  const ownerTagAuthorization = await client.call("Authorize", { idTag: ownerTag });
  const secondOwnerTagAuthorization = await client.call("Authorize", { idTag: secondOwnerTag });
  const unknownAuthorization = await client.call("Authorize", { idTag: unknownTag });
  const transactionStartedAt = new Date().toISOString();
  const transaction = await client.call("StartTransaction", {
    connectorId: 1,
    idTag: ownerTag,
    meterStart: 10_000,
    timestamp: transactionStartedAt,
  });
  assert(
    transaction.idTagInfo?.status === "Accepted" && Number.isInteger(transaction.transactionId),
    "synthetic owner transaction did not start",
  );
  await client.call("MeterValues", {
    connectorId: 1,
    meterValue: [
      {
        sampledValue: [
          {
            context: "Sample.Periodic",
            measurand: "Energy.Active.Import.Register",
            unit: "Wh",
            value: "10500",
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
    transactionId: transaction.transactionId,
  });
  await client.call("StopTransaction", {
    idTag: ownerTag,
    meterStop: 11_000,
    timestamp: new Date().toISOString(),
    transactionId: transaction.transactionId,
  });
  assert(boot.status === "Accepted", "synthetic station boot was not accepted over WSS");
  assert(typeof heartbeat.currentTime === "string", "synthetic heartbeat was not accepted");
  assert(ownerTagAuthorization.idTagInfo?.status === "Accepted", "owner tag was not accepted");
  assert(
    secondOwnerTagAuthorization.idTagInfo?.status === "Accepted",
    "durably added owner tag was not accepted",
  );
  assert(unknownAuthorization.idTagInfo?.status === "Invalid", "unknown tag did not fail closed");
  assert(client.protocol === "ocpp1.6", "Caddy did not preserve the OCPP 1.6 subprotocol");
  await client.close({ force: true });
  client = undefined;

  await retry(async () => {
    const disconnected = await httpsRequest(
      ownerDomain,
      tlsPort,
      "/api/v1/snapshot",
      ownerAuthorization,
    );
    if (disconnected.status !== 200 || JSON.parse(disconnected.body).station?.connected !== false) {
      throw new Error("charge point disconnect was not observed yet");
    }
    return disconnected;
  });

  client = createSyntheticClient(tlsPort, true);
  await client.connect();
  await client.call("BootNotification", {
    chargePointModel: "Production smoke",
    chargePointVendor: "chargeOS test",
    firmwareVersion: "synthetic",
  });
  const bufferedStart = {
    connectorId: 1,
    idTag: ownerTag,
    meterStart: 20_000,
    timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
  const bufferedTransaction = await client.call("StartTransaction", bufferedStart);
  const bufferedMeter = {
    connectorId: 1,
    meterValue: [
      {
        sampledValue: [
          {
            context: "Sample.Periodic",
            measurand: "Energy.Active.Import.Register",
            unit: "Wh",
            value: "20750",
          },
        ],
        timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ],
    transactionId: bufferedTransaction.transactionId,
  };
  const bufferedStop = {
    idTag: ownerTag,
    meterStop: 21_500,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    transactionId: bufferedTransaction.transactionId,
  };
  await client.call("MeterValues", bufferedMeter);
  await client.call("StopTransaction", bufferedStop);

  const replayedStart = await client.call("StartTransaction", bufferedStart);
  await client.call("MeterValues", bufferedMeter);
  await client.call("StopTransaction", bufferedStop);
  assert(
    replayedStart.transactionId === bufferedTransaction.transactionId,
    "replayed start received a different transaction ID",
  );
  await client.close({ force: true });
  client = undefined;

  const freedomRun = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/freedom-test/runs",
    ownerAuthorization,
    {
      confirmation:
        "I am starting a witnessed Freedom Test for this exact device and migration baseline",
    },
  );
  assert(
    freedomRun.status === 201 && JSON.parse(freedomRun.body).run?.state === "active",
    `bound Freedom Test run returned ${freedomRun.status}: ${freedomRun.body}`,
  );

  const snapshot = await httpsRequest(ownerDomain, tlsPort, "/api/v1/snapshot", ownerAuthorization);
  assert(snapshot.status === 200, `authenticated HTTPS snapshot returned ${snapshot.status}`);
  const ownerSnapshot = JSON.parse(snapshot.body);
  assert(
    ownerSnapshot.freedomTest?.device?.identityMatch === "match",
    "authorized Boot did not match the pre-switch device inventory",
  );
  assert(
    ownerSnapshot.migration?.steps?.find((step) => step.id === "authorized-boot-observed")
      ?.state === "pass",
    "deployed migration projection did not accept the matching authorized Boot",
  );
  assert(
    ownerSnapshot.migration?.status === "online-path-observed-unreviewed",
    "deployed migration projection did not complete the authorized online path",
  );
  assert(
    ownerSnapshot.freedomTest?.status === "in-progress" &&
      ownerSnapshot.freedomTest?.run?.state === "active" &&
      ownerSnapshot.freedomTest.steps
        .filter((step) => step.source === "automatic")
        .every((step) => step.state === "pass"),
    "deployed Freedom Test did not derive every automatic online step",
  );
  assert(
    ownerSnapshot.genesisPlan?.phase === "physical-freedom-test" &&
      ownerSnapshot.genesisPlan?.nextActions?.[0]?.id === "complete-witnessed-step" &&
      ownerSnapshot.genesisPlan?.nextActions?.[0]?.freedomTestStepId ===
        "owner-charge-with-wan-and-backend-down",
    "deployed Genesis plan did not select the first bound physical outage step",
  );
  const genesisPlanResponse = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/genesis-plan",
    ownerAuthorization,
  );
  assert(genesisPlanResponse.status === 200, "Genesis plan endpoint was unavailable");
  assert(
    JSON.parse(genesisPlanResponse.body).nextActions?.[0]?.safety === "witnessed-real-energy",
    "Genesis plan endpoint did not preserve the physical evidence safety boundary",
  );
  assert(
    ownerSnapshot.authorization?.syncState === "current" &&
      ownerSnapshot.authorization.pendingAdditions?.length === 0 &&
      ownerSnapshot.authorization.pendingRevocations?.length === 0 &&
      ownerSnapshot.authorization.lastSyncRevision ===
        ownerSnapshot.authorization.lastAttemptRevision &&
      ownerSnapshot.authorization.lastAttemptStatus === "Accepted",
    "deployed owner authorization did not reconcile desired and acknowledged lists",
  );
  assert(
    ownerSnapshot.sessions?.some(
      (session) =>
        session.transactionId === transaction.transactionId &&
        session.status === "complete" &&
        session.energyWh === 1_000,
    ),
    "deployed owner projection did not persist the complete energy session",
  );
  assert(ownerSnapshot.sessions?.length === 2, "replayed traffic duplicated a projected session");
  assert(
    ownerSnapshot.sessions?.some(
      (session) =>
        session.transactionId === bufferedTransaction.transactionId &&
        session.authorizationStatus === "Accepted" &&
        session.energyWh === 1_500 &&
        session.integrity === "consistent" &&
        session.replayedMessageCount === 3 &&
        session.status === "complete",
    ),
    "deployed projection did not reconcile exact start/meter/stop retries once",
  );
  const fieldPackResponse = await httpsRequest(
    ownerDomain,
    tlsPort,
    "/api/v1/field-pack",
    ownerAuthorization,
  );
  assert(fieldPackResponse.status === 200, `field pack returned ${fieldPackResponse.status}`);
  const fieldPackPath = join(secretDirectory, "field-pack.json");
  writeFileSync(fieldPackPath, fieldPackResponse.body, { encoding: "utf8", mode: 0o600 });
  const fieldPackVerification = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/field-pack-cli.ts"),
      "verify",
      "--pack",
      fieldPackPath,
    ]),
  );
  assert(fieldPackVerification.verified === true, "field pack verification did not succeed");
  assert(
    fieldPackVerification.migrationStatus === "online-path-observed-unreviewed" &&
      fieldPackVerification.freedomTestStatus === "in-progress",
    "field pack did not preserve the deployed migration/Freedom states",
  );

  const continuityBundle = run(
    "docker",
    [
      "exec",
      "--interactive",
      chargeosId,
      "node",
      "dist/server/continuity-cli.js",
      "export-stdout",
      "--passphrase-stdin",
    ],
    { input: `${continuityRecoveryPassphrase}\n` },
  );
  const continuityBundlePath = join(secretDirectory, "owner.continuity.json");
  const continuityPassphrasePath = join(secretDirectory, "continuity-passphrase");
  writeFileSync(continuityBundlePath, continuityBundle, { encoding: "utf8", mode: 0o600 });
  writeFileSync(continuityPassphrasePath, continuityRecoveryPassphrase, {
    encoding: "utf8",
    mode: 0o600,
  });
  const continuityInspection = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/continuity-cli.ts"),
      "inspect",
      "--bundle",
      continuityBundlePath,
      "--passphrase-file",
      continuityPassphrasePath,
    ]),
  );
  assert(
    continuityInspection.payloadSchemaVersion === 3 &&
      continuityInspection.ownerTagCount === 2 &&
      continuityInspection.recoveryPolicy?.sourceTrustedProxyHeaders === true &&
      continuityInspection.recoveryPolicy?.restoredTrustProxyHeaders === false,
    "production continuity export did not preserve the versioned recovery policy",
  );
  const productionRecoveryPath = join(secretDirectory, "production-recovery");
  run(join(root, "node_modules/.bin/tsx"), [
    join(root, "server/continuity-cli.ts"),
    "restore-production",
    "--bundle",
    continuityBundlePath,
    "--passphrase-file",
    continuityPassphrasePath,
    "--target",
    productionRecoveryPath,
    "--ocpp-domain",
    ocppDomain,
    "--owner-domain",
    ownerDomain,
    "--acme-email",
    "owner@example.net",
  ]);
  const productionRecoveryManifest = JSON.parse(
    readFileSync(join(productionRecoveryPath, "restore-manifest.json"), "utf8"),
  );
  assert(
    productionRecoveryManifest.productionRecovery?.ledgerInstallRequired === true &&
      productionRecoveryManifest.productionRecovery?.proxyTopologyValidated === false,
    "production recovery package did not preserve its install and topology gates",
  );
  assert(
    readFileSync(join(productionRecoveryPath, "secrets", "owner-tags"), "utf8") ===
      `${ownerTag}\n${secondOwnerTag}\n`,
    "production recovery did not preserve runtime-managed owner RFID state",
  );
  const recoveryDataPath = join(secretDirectory, "replacement-data");
  mkdirSync(recoveryDataPath, { mode: 0o777 });
  const recoveredSecrets = join(productionRecoveryPath, "secrets");
  const productionRecoveryEnvironment = parseEnv(
    readFileSync(join(productionRecoveryPath, ".env.production"), "utf8"),
  );
  const recoveredLimitEnvironment = [
    "CHARGEOS_EVENT_LOG_MAX_BYTES",
    "CHARGEOS_OCPP_MAX_CONNECTIONS",
    "CHARGEOS_OCPP_MAX_PAYLOAD_BYTES",
    "CHARGEOS_OCPP_MESSAGE_BURST",
    "CHARGEOS_OCPP_MESSAGES_PER_MINUTE",
  ].flatMap((name) => ["--env", `${name}=${productionRecoveryEnvironment[name]}`]);
  const installOutput = run("docker", [
    "run",
    "--rm",
    ...recoveredLimitEnvironment,
    "--volume",
    `${recoveryDataPath}:/data`,
    "--volume",
    `${join(productionRecoveryPath, "events.ndjson")}:/recovery/events.ndjson:ro`,
    "--volume",
    `${join(productionRecoveryPath, "events.ndjson.archives")}:/recovery/events.ndjson.archives:ro`,
    "--volume",
    `${join(recoveredSecrets, "station-secret")}:/run/secrets/station_secret:ro`,
    "--volume",
    `${join(recoveredSecrets, "owner-api-token")}:/run/secrets/owner_api_token:ro`,
    "--volume",
    `${join(recoveredSecrets, "owner-tags")}:/run/secrets/owner_tags:ro`,
    "--env",
    `CHARGEOS_STATION_ID=${stationId}`,
    "--env",
    "CHARGEOS_STATION_SECRET_FILE=/run/secrets/station_secret",
    "--env",
    "CHARGEOS_OWNER_API_TOKEN_FILE=/run/secrets/owner_api_token",
    "--env",
    "CHARGEOS_OWNER_TAGS_FILE=/run/secrets/owner_tags",
    runtimeImage,
    "node",
    "dist/server/continuity-cli.js",
    "install-ledger",
    "--source",
    "/recovery/events.ndjson",
  ]);
  assert(
    /^Installed \d+ verified recovery events into \/data\/events\.ndjson\n$/u.test(installOutput),
    "replacement production volume did not receive the verified recovery ledger",
  );
  const replacementContainerOptions = [
    ...recoveredLimitEnvironment,
    "--read-only",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:size=16m,mode=1777",
    "--volume",
    `${recoveryDataPath}:/data`,
    "--volume",
    `${join(recoveredSecrets, "station-secret")}:/run/secrets/station_secret:ro`,
    "--volume",
    `${join(recoveredSecrets, "owner-api-token")}:/run/secrets/owner_api_token:ro`,
    "--volume",
    `${join(recoveredSecrets, "owner-tags")}:/run/secrets/owner_tags:ro`,
    "--env",
    `CHARGEOS_STATION_ID=${stationId}`,
    "--env",
    "CHARGEOS_STATION_SECRET_FILE=/run/secrets/station_secret",
    "--env",
    "CHARGEOS_OWNER_API_TOKEN_FILE=/run/secrets/owner_api_token",
    "--env",
    "CHARGEOS_OWNER_TAGS_FILE=/run/secrets/owner_tags",
  ];
  const startReplacementEdge = () =>
    run("docker", [
      "run",
      "--detach",
      "--name",
      recoveryContainerName,
      ...replacementContainerOptions,
      runtimeImage,
    ]).trim();
  recoveryContainerId = startReplacementEdge();
  await waitForHealthyContainer(recoveryContainerId);
  const recoveryLogs = run("docker", ["logs", recoveryContainerId]);
  assert(
    recoveryLogs.includes("chargeOS OCPP 1.6J listening") &&
      recoveryLogs.includes("chargeOS owner UI/API listening"),
    "replacement production edge did not boot from the installed recovery ledger",
  );
  for (const secret of [ownerToken, ownerTag, secondOwnerTag, stationSecret]) {
    assert(!recoveryLogs.includes(secret), "replacement production logs leaked a recovered secret");
  }

  const replacementContinuityBundle = run(
    "docker",
    [
      "exec",
      "--interactive",
      recoveryContainerId,
      "node",
      "dist/server/continuity-cli.js",
      "export-stdout",
      "--passphrase-stdin",
    ],
    { input: `${continuityRecoveryPassphrase}\n` },
  );
  const replacementContinuityBundlePath = join(
    secretDirectory,
    "replacement-pre-archive.continuity.json",
  );
  writeFileSync(replacementContinuityBundlePath, replacementContinuityBundle, {
    encoding: "utf8",
    mode: 0o600,
  });
  const replacementContinuityInspection = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/continuity-cli.ts"),
      "inspect",
      "--bundle",
      replacementContinuityBundlePath,
      "--passphrase-file",
      continuityPassphrasePath,
    ]),
  );
  assert(
    replacementContinuityInspection.eventCount === continuityInspection.eventCount + 1 &&
      replacementContinuityInspection.ownerTagCount === 2,
    "replacement edge did not checkpoint its recovered owner-tag state before archive",
  );

  run("docker", ["rm", "--force", recoveryContainerName]);
  recoveryContainerId = undefined;
  const postArchiveBundle = run(
    "docker",
    [
      "run",
      "--rm",
      "--interactive",
      ...replacementContainerOptions,
      "--volume",
      `${replacementContinuityBundlePath}:/recovery/pre-archive.continuity.json:ro`,
      runtimeImage,
      "node",
      "dist/server/continuity-cli.js",
      "archive-stdout",
      "--bundle",
      "/recovery/pre-archive.continuity.json",
      "--passphrase-stdin",
      "--confirmation",
      evidenceArchiveConfirmation,
    ],
    { input: `${continuityRecoveryPassphrase}\n` },
  );
  const postArchiveBundlePath = join(secretDirectory, "post-archive.continuity.json");
  writeFileSync(postArchiveBundlePath, postArchiveBundle, { encoding: "utf8", mode: 0o600 });
  const postArchiveInspection = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/continuity-cli.ts"),
      "inspect",
      "--bundle",
      postArchiveBundlePath,
      "--passphrase-file",
      continuityPassphrasePath,
    ]),
  );
  assert(
    postArchiveInspection.archiveSegmentCount === 1 &&
      postArchiveInspection.currentEventCount === 1 &&
      postArchiveInspection.eventCount === replacementContinuityInspection.eventCount + 1,
    "offline archive did not preserve the complete encrypted evidence chain",
  );
  recoveryContainerId = startReplacementEdge();
  await waitForHealthyContainer(recoveryContainerId);
  assert(
    run("docker", ["logs", recoveryContainerId]).includes("chargeOS OCPP 1.6J listening"),
    "replacement edge did not restart from the archived evidence chain",
  );
  run("docker", ["rm", "--force", recoveryContainerName]);
  recoveryContainerId = undefined;

  const compactedBundlePath = join(secretDirectory, "compacted.continuity.json");
  run(join(root, "node_modules/.bin/tsx"), [
    join(root, "server/continuity-cli.ts"),
    "compact",
    "--bundle",
    postArchiveBundlePath,
    "--output",
    compactedBundlePath,
    "--passphrase-file",
    continuityPassphrasePath,
    "--confirmation",
    evidenceCompactionConfirmation,
  ]);
  const custodyVerification = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/continuity-cli.ts"),
      "verify-custody",
      "--bundle",
      compactedBundlePath,
      "--source-bundle",
      postArchiveBundlePath,
      "--passphrase-file",
      continuityPassphrasePath,
    ]),
  );
  const compactedInspection = JSON.parse(
    run(join(root, "node_modules/.bin/tsx"), [
      join(root, "server/continuity-cli.ts"),
      "inspect",
      "--bundle",
      compactedBundlePath,
      "--passphrase-file",
      continuityPassphrasePath,
    ]),
  );
  assert(
    custodyVerification.verified === true &&
      compactedInspection.payloadSchemaVersion === 4 &&
      compactedInspection.archiveSegmentCount === 0 &&
      compactedInspection.evidenceHistory?.mode === "compacted-operational" &&
      compactedInspection.evidenceHistory?.omittedEventCount > 0 &&
      compactedInspection.eventCount <= postArchiveInspection.eventCount,
    "compacted recovery did not preserve explicit off-edge custody and reduce local history",
  );

  const compactedRecoveryPath = join(secretDirectory, "compacted-production-recovery");
  run(join(root, "node_modules/.bin/tsx"), [
    join(root, "server/continuity-cli.ts"),
    "restore-production",
    "--bundle",
    compactedBundlePath,
    "--passphrase-file",
    continuityPassphrasePath,
    "--target",
    compactedRecoveryPath,
    "--ocpp-domain",
    "compacted-ocpp.localhost",
    "--owner-domain",
    "compacted-owner.localhost",
    "--acme-email",
    "owner@example.net",
  ]);
  const compactedDataPath = join(secretDirectory, "compacted-data");
  mkdirSync(compactedDataPath, { mode: 0o777 });
  const compactedSecrets = join(compactedRecoveryPath, "secrets");
  run("docker", [
    "run",
    "--rm",
    ...recoveredLimitEnvironment,
    "--volume",
    `${compactedDataPath}:/data`,
    "--volume",
    `${join(compactedRecoveryPath, "events.ndjson")}:/recovery/events.ndjson:ro`,
    "--volume",
    `${join(compactedRecoveryPath, "events.ndjson.archives")}:/recovery/events.ndjson.archives:ro`,
    "--volume",
    `${join(compactedSecrets, "station-secret")}:/run/secrets/station_secret:ro`,
    "--volume",
    `${join(compactedSecrets, "owner-api-token")}:/run/secrets/owner_api_token:ro`,
    "--volume",
    `${join(compactedSecrets, "owner-tags")}:/run/secrets/owner_tags:ro`,
    "--env",
    `CHARGEOS_STATION_ID=${stationId}`,
    "--env",
    "CHARGEOS_STATION_SECRET_FILE=/run/secrets/station_secret",
    "--env",
    "CHARGEOS_OWNER_API_TOKEN_FILE=/run/secrets/owner_api_token",
    "--env",
    "CHARGEOS_OWNER_TAGS_FILE=/run/secrets/owner_tags",
    runtimeImage,
    "node",
    "dist/server/continuity-cli.js",
    "install-ledger",
    "--source",
    "/recovery/events.ndjson",
  ]);
  const compactedContainerOptions = replacementContainerOptions.map((value) =>
    value === `${recoveryDataPath}:/data`
      ? `${compactedDataPath}:/data`
      : value.replace(recoveredSecrets, compactedSecrets),
  );
  recoveryContainerId = run("docker", [
    "run",
    "--detach",
    "--name",
    recoveryContainerName,
    ...compactedContainerOptions,
    runtimeImage,
  ]).trim();
  await waitForHealthyContainer(recoveryContainerId);
  assert(
    run("docker", ["logs", recoveryContainerId]).includes("chargeOS OCPP 1.6J listening"),
    "replacement edge did not boot from compacted operational recovery",
  );

  const evidence = run("docker", ["exec", chargeosId, "cat", "/data/events.ndjson"]);
  const logs = `${run("docker", ["logs", chargeosId])}\n${run("docker", ["logs", caddyName])}`;
  for (const secret of [ownerToken, ownerTag, secondOwnerTag, unknownTag, stationSecret]) {
    assert(!snapshot.body.includes(secret), "owner snapshot leaked a raw synthetic secret");
    assert(!fieldPackResponse.body.includes(secret), "field pack leaked a raw synthetic secret");
    assert(!continuityBundle.includes(secret), "continuity envelope exposed a raw secret");
    assert(!evidence.includes(secret), "sealed evidence leaked a raw synthetic secret");
    assert(!logs.includes(secret), "container logs leaked a raw synthetic secret");
  }

  console.log(
    `Production runtime smoke test passed${requestedRuntimeImage ? " for an immutable image digest" : ""}: isolated non-root containers, HTTPS, canonical dossier-matched migration authorization, identity-bound OCPP 1.6 WSS migration, one-way owner-continuity preparation, capability inspection, desired/acknowledged authorization reconciliation, online energy, reconnect/retry reconciliation, fail-closed unknown tags, in-container continuity export, non-overwriting production restore, offline evidence archive, custody-linked compacted replacement boot, field-pack verification, and secret redaction`,
  );
} catch (error) {
  if (chargeosId) {
    const logs = runIgnoringFailureWithOutput("docker", ["logs", chargeosId]);
    if (logs) console.error(redactSyntheticSecrets(logs));
  }
  throw error;
} finally {
  await client?.close({ force: true }).catch(() => undefined);
  if (caddyStarted) runIgnoringFailure("docker", ["rm", "--force", caddyName]);
  if (recoveryContainerId) {
    runIgnoringFailure("docker", ["rm", "--force", recoveryContainerName]);
  }
  runIgnoringFailure(
    "docker",
    [...composeArguments, "down", "--volumes", "--remove-orphans"],
    composeEnvironment,
  );
  rmSync(secretDirectory, { force: true, recursive: true });
}

function verifyChargeosContainer(containerId, expectedImage) {
  const inspect = JSON.parse(run("docker", ["inspect", containerId]))[0];
  assert(
    inspect.Config?.Image === expectedImage,
    `production container uses ${inspect.Config?.Image}, expected ${expectedImage}`,
  );
  assert(inspect.Config?.User === "chargeos", "production image must declare the chargeos user");
  assert(inspect.HostConfig?.ReadonlyRootfs === true, "chargeOS root filesystem is writable");
  assert(inspect.HostConfig?.Privileged === false, "chargeOS container is privileged");
  assert(
    inspect.HostConfig?.SecurityOpt?.includes("no-new-privileges:true"),
    "chargeOS privilege escalation is enabled",
  );
  assert(inspect.State?.Health?.Status === "healthy", "chargeOS container is not healthy");
  assert(
    Object.values(inspect.NetworkSettings?.Ports ?? {}).every((bindings) => bindings === null),
    "chargeOS published a host port",
  );
  assert(
    Object.keys(inspect.NetworkSettings?.Networks ?? {}).length === 1 &&
      Object.hasOwn(inspect.NetworkSettings.Networks, `${projectName}_chargeos-internal`),
    "chargeOS escaped its internal-only network",
  );
  assert(
    typeof inspect.HostConfig?.Tmpfs?.["/data"] === "string",
    "runtime smoke evidence storage must be an isolated tmpfs",
  );
  const uid = Number.parseInt(
    run("docker", ["exec", "--user", "chargeos", containerId, "id", "-u"]),
  );
  assert(Number.isInteger(uid) && uid !== 0, "chargeOS runtime user is root");
  for (const path of [
    "/run/secrets/owner_api_token",
    "/run/secrets/owner_tags",
    "/run/secrets/station_secret",
  ]) {
    assert(
      run("docker", ["exec", containerId, "stat", "-c", "%a", path]).trim() === "444",
      `${path} is not mounted read-only`,
    );
  }
}

function verifyCaddyContainer() {
  const inspect = JSON.parse(run("docker", ["inspect", caddyName]))[0];
  assert(inspect.HostConfig?.ReadonlyRootfs === true, "Caddy root filesystem is writable");
  assert(inspect.HostConfig?.Privileged === false, "Caddy container is privileged");
  assert(inspect.Config?.User === "1000:1000", "Caddy does not run as the unprivileged user");
  const status = run("docker", ["exec", caddyName, "cat", "/proc/1/status"]);
  assert(/^Uid:\s+1000\s/mu.test(status), "Caddy process is not running as uid 1000");
  assert(
    /^CapEff:\s+0000000000000400$/mu.test(status),
    "Caddy process holds capabilities beyond NET_BIND_SERVICE",
  );
  assert(
    inspect.HostConfig?.SecurityOpt?.includes("no-new-privileges:true"),
    "Caddy privilege escalation is enabled",
  );
  assert(
    inspect.HostConfig?.CapDrop?.includes("ALL") &&
      inspect.HostConfig?.CapAdd?.length === 1 &&
      inspect.HostConfig.CapAdd[0] === "NET_BIND_SERVICE",
    "Caddy capabilities differ from the production boundary",
  );
  assert(
    Object.hasOwn(inspect.NetworkSettings?.Networks ?? {}, "bridge") &&
      Object.hasOwn(inspect.NetworkSettings?.Networks ?? {}, `${projectName}_chargeos-internal`),
    "Caddy does not have separate edge and internal interfaces",
  );
}

function createSyntheticClient(tlsPort, continuityReady = false) {
  const configurationValues = {
    AllowOfflineTxForUnknownId: continuityReady ? "false" : "true",
    AuthorizationCacheEnabled: "true",
    LocalAuthListEnabled: continuityReady ? "true" : "false",
    LocalAuthListMaxLength: "100",
    LocalAuthorizeOffline: continuityReady ? "true" : "false",
    SendLocalListMaxLength: "100",
    TransactionMessageAttempts: "3",
    TransactionMessageRetryInterval: "30",
  };
  const syntheticClient = new RPCClient({
    endpoint: `wss://${ocppDomain}:${tlsPort}`,
    identity: stationId,
    password: stationSecret,
    protocols: ["ocpp1.6"],
    strictMode: true,
    wsOpts: { lookup: localLookup, rejectUnauthorized: false },
  });
  syntheticClient.handle("GetConfiguration", async ({ params }) => ({
    configurationKey: params.key.map((key) => ({
      key,
      readonly: false,
      value: configurationValues[key] ?? "true",
    })),
  }));
  syntheticClient.handle("ChangeConfiguration", async ({ params }) => {
    configurationValues[params.key] = params.value;
    return { status: "Accepted" };
  });
  syntheticClient.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
  syntheticClient.handle("SendLocalList", async () => ({ status: "Accepted" }));
  return syntheticClient;
}

function syntheticMigrationTarget(createdAt) {
  return `${JSON.stringify(
    {
      createdAt,
      evidence: {
        configurationBackupSha256: "6".padStart(64, "0"),
        configurationPathEvidenceSha256: "3".padStart(64, "0"),
        continuityRestoreEvidenceSha256: "b".padStart(64, "0"),
        credentialCustodyEvidenceSha256: "a".padStart(64, "0"),
        deviceInventoryEvidenceSha256: "d".repeat(64),
        standaloneRollbackEvidenceSha256: "8".padStart(64, "0"),
        transactionExportSha256: "7".padStart(64, "0"),
        transportValidationEvidenceSha256: "c".padStart(64, "0"),
      },
      format: "chargeos-migration-target",
      procedure: {
        configurationPath: "Synthetic production runtime smoke",
        physicalWork: "qualified-installer-power-isolated",
      },
      safety: {
        containsSecrets: false,
        endpointChangeAuthorizedSeparately: true,
        localOwnerAuthorizationMustRemainEnabled: true,
      },
      schemaVersion: 1,
      station: {
        expectedFirmwareVersion: "synthetic",
        expectedModel: "Production smoke",
        expectedVendor: "chargeOS test",
        id: stationId,
      },
      target: {
        credentialCustody: "owner-held-separately",
        endpoint: `ws://192.168.50.4:9000/${stationId}`,
        protocol: "ocpp1.6j",
        stationAuthentication: "http-basic-unique-secret",
        transport: "isolated-lan-ws",
        transportValidation: "isolated-owner-lan-only",
      },
    },
    null,
    2,
  )}\n`;
}

function httpsRequest(domain, port, path, authorization, body) {
  return new Promise((resolve, reject) => {
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const requestHeaders = {
      ...(authorization ? { authorization } : {}),
      ...(serializedBody
        ? {
            "content-length": Buffer.byteLength(serializedBody),
            "content-type": "application/json",
          }
        : {}),
    };
    const outgoing = request(
      {
        headers: requestHeaders,
        hostname: domain,
        lookup: localLookup,
        method: serializedBody ? "POST" : "GET",
        path,
        port,
        rejectUnauthorized: false,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ body, headers: response.headers, status: response.statusCode });
        });
      },
    );
    outgoing.on("error", reject);
    if (serializedBody) outgoing.write(serializedBody);
    outgoing.end();
  });
}

function localLookup(_hostname, options, callback) {
  if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
}

async function retry(operation) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function waitForHealthyContainer(containerId) {
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const inspect = JSON.parse(run("docker", ["inspect", containerId]))[0];
    lastStatus = inspect.State?.Health?.Status ?? inspect.State?.Status ?? "unknown";
    if (lastStatus === "healthy") return;
    if (inspect.State?.Running === false || inspect.RestartCount >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = run("docker", ["logs", containerId]);
  throw new Error(`chargeOS did not become healthy (${lastStatus})\n${logs}`);
}

function writeSecret(path, value) {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o444);
}

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function runIgnoringFailure(command, arguments_, env = process.env) {
  try {
    run(command, arguments_, { env, stdio: "ignore" });
  } catch {
    // Cleanup is best effort; preserve the original verification error.
  }
}

function runIgnoringFailureWithOutput(command, arguments_, env = process.env) {
  try {
    return run(command, arguments_, { env });
  } catch {
    return "";
  }
}

function redactSyntheticSecrets(value) {
  return [ownerToken, ownerTag, secondOwnerTag, unknownTag, stationSecret].reduce(
    (redacted, secret) => redacted.replaceAll(secret, "[redacted]"),
    value,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
