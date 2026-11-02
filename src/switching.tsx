/**
 * Switching, Freedom Test and Genesis plan pages. These carry exact safety and evidence wording that
 * has not been reviewed in other languages yet, so they stay in English and say so.
 */
import { useState } from "preact/hooks";

import type {
  FreedomTestDeviceInput,
  FreedomTestProjection,
  FreedomTestStepResult,
  GenesisAction,
  GenesisPhase,
  GenesisPlan,
  MigrationPhase,
  MigrationProjection,
  MigrationStepResult,
  OwnerSnapshot,
} from "../shared/contracts.js";
import { FREEDOM_TEST_RUN_CONFIRMATION_PHRASE } from "../shared/freedom-test.js";
import { MIGRATION_AUTHORIZATION_PHRASE } from "../shared/migration.js";
import { formatDate } from "./i18n/index.js";
import { EmptyEvidenceFileError, sha256File } from "./sha256.js";
import {
  action,
  runFieldPackExport,
  runFreedomDeviceSave,
  runFreedomObservationSave,
  runFreedomReportExport,
  runFreedomTestStart,
  runMigrationAuthorization,
  runMigrationCheckpointSave,
  runMigrationReportExport,
} from "./model.js";

/**
 * Computes an evidence file's SHA-256 in this browser so the owner does not need a terminal. The
 * file is read locally and never uploaded; only the digest is handed to the input next to it.
 */
export function EvidenceFileDigest({
  label,
  value,
  onDigest,
}: {
  label: string;
  /** The digest field's current value; the "filled in" note only stands while it is unchanged. */
  value: string;
  onDigest(value: string): void;
}) {
  const [state, setState] = useState<
    | { readonly kind: "idle" }
    | { readonly kind: "hashing"; readonly percent: number }
    | { readonly kind: "done"; readonly name: string; readonly digest: string }
    | { readonly kind: "error"; readonly message: string }
  >({ kind: "idle" });
  return (
    <span class="file-digest">
      <label class="button secondary compact file-digest-button">
        {state.kind === "hashing" ? `Reading file… ${state.percent}%` : "Choose evidence file"}
        <input
          type="file"
          class="visually-hidden"
          aria-label={`Choose the evidence file for ${label}; it stays on this computer`}
          disabled={state.kind === "hashing"}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            // Clear the selection so choosing the same file again re-reads it.
            input.value = "";
            if (!file) return;
            setState({ kind: "hashing", percent: 0 });
            void sha256File(file, (fraction) =>
              setState({ kind: "hashing", percent: Math.floor(fraction * 100) }),
            ).then(
              (digest) => {
                onDigest(digest);
                setState({ digest, kind: "done", name: file.name });
              },
              (error: unknown) =>
                setState({
                  kind: "error",
                  message:
                    error instanceof EmptyEvidenceFileError
                      ? "That file is empty. Choose the evidence file itself."
                      : "The file could not be read. Choose it again.",
                }),
            );
          }}
        />
      </label>
      <small class="file-digest-note" role="status">
        {state.kind === "done" && state.digest === value
          ? `Fingerprint of ${state.name} filled in. The file was not uploaded.`
          : state.kind === "error"
            ? state.message
            : "Stays on this computer; only its fingerprint is used."}
      </small>
    </span>
  );
}

export function CompactedHistoryNotice({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <div class="notice history-warning" role="status">
      This edge uses compacted operational history. It carries state from{" "}
      {current.evidenceHistory.custodyBundleCount} separately held source bundle
      {current.evidenceHistory.custodyBundleCount === 1 ? "" : "s"} covering{" "}
      {current.evidenceHistory.custodiedEventCount} records. Full historical review requires those
      source bundles; this local ledger is not the original complete chain.
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Genesis plan                                                        */
/* ------------------------------------------------------------------ */

const GENESIS_PHASES: readonly { label: string; phase: GenesisPhase }[] = [
  { label: "Pre-switch evidence", phase: "pre-switch-evidence" },
  { label: "Owner authorization", phase: "owner-authorization" },
  { label: "Endpoint change", phase: "endpoint-change" },
  { label: "Online proof", phase: "online-proof" },
  { label: "Physical Freedom Test", phase: "physical-freedom-test" },
  { label: "Independent review", phase: "independent-review" },
];

const ACTOR_LABELS: Readonly<Record<GenesisAction["actor"], string>> = {
  installer: "Installer",
  owner: "Owner",
  reviewer: "Reviewer",
  station: "Charger",
  witness: "Witness",
};

const EXECUTION_LABELS: Readonly<Record<GenesisAction["execution"], string>> = {
  "external-manual": "Outside chargeOS",
  "local-cli": "Local command line",
  observe: "Observed automatically",
  "owner-console": "In this console",
  review: "Independent review",
};

const EVIDENCE_LABELS: Readonly<Record<GenesisAction["evidence"], string>> = {
  "external-sha256": "SHA-256 of held evidence",
  none: "No evidence recorded",
  "protocol-derived": "From protocol records",
  "review-pack": "Field review pack",
};

const SAFETY_LABELS: Readonly<Record<GenesisAction["safety"], string>> = {
  ordinary: "Ordinary",
  "power-isolated-competent-installer": "Power isolated, competent installer",
  "supported-installer-procedure": "Supported installer procedure",
  "witnessed-real-energy": "Witnessed with real energy",
};

export function GenesisPlanPanel({ plan }: { plan: GenesisPlan }) {
  const title =
    plan.state === "stop"
      ? "Stop condition — preserve evidence"
      : plan.state === "ready-for-review"
        ? "Field evidence ready for independent review"
        : plan.state === "waiting-for-station"
          ? "Waiting for exact station evidence"
          : plan.nextActions.length === 1
            ? "Next safe action"
            : "Next safe actions";
  const currentPhase = GENESIS_PHASES.findIndex(({ phase }) => phase === plan.phase);
  const [featured, ...rest] = plan.nextActions;
  const visible = rest.slice(0, 3);
  const folded = rest.slice(3);
  return (
    <section class={`panel glass genesis-plan ${plan.state}`} aria-labelledby="genesis-title">
      <header class="panel-head">
        <div>
          <p class="panel-kicker">Genesis plan</p>
          <h2 id="genesis-title">{title}</h2>
        </div>
      </header>

      <ol class="phase-track" aria-label="Genesis phases">
        {GENESIS_PHASES.map(({ label, phase }, index) => (
          <li
            key={phase}
            class={index < currentPhase ? "done" : index === currentPhase ? "current" : "upcoming"}
            aria-current={index === currentPhase ? "step" : undefined}
          >
            <span class="phase-index" aria-hidden="true">
              {index + 1}
            </span>
            <span class="phase-label">{label}</span>
          </li>
        ))}
      </ol>

      {featured ? (
        <ol class="genesis-actions">
          <GenesisActionItem next={featured} index={0} featured />
          {visible.map((next, index) => (
            <GenesisActionItem
              key={`${next.id}-${next.migrationStepId ?? next.freedomTestStepId ?? index}`}
              next={next}
              index={index + 1}
            />
          ))}
        </ol>
      ) : (
        <p class="empty-state">No console action is due right now.</p>
      )}
      {folded.length > 0 && (
        <details class="genesis-more">
          <summary>
            Show {folded.length} more action{folded.length === 1 ? "" : "s"}
          </summary>
          <ol class="genesis-actions" start={visible.length + 2}>
            {folded.map((next, index) => (
              <GenesisActionItem
                key={`${next.id}-${next.migrationStepId ?? next.freedomTestStepId ?? index}`}
                next={next}
                index={index + visible.length + 1}
              />
            ))}
          </ol>
        </details>
      )}
      <p class="fine-print">{plan.disclaimer}</p>
    </section>
  );
}

function GenesisActionItem({
  next,
  index,
  featured = false,
}: {
  next: GenesisAction;
  index: number;
  featured?: boolean;
}) {
  const elevated = next.safety !== "ordinary";
  return (
    <li class={`genesis-action${featured ? " featured" : ""}`}>
      <span class="genesis-index" aria-hidden="true">
        {index + 1}
      </span>
      <div class="genesis-body">
        <p class="genesis-instruction">{next.instruction}</p>
        <div class="genesis-meta">
          <span>{ACTOR_LABELS[next.actor]}</span>
          <span>{EXECUTION_LABELS[next.execution]}</span>
          <span>{EVIDENCE_LABELS[next.evidence]}</span>
          {elevated && <span class="safety">{SAFETY_LABELS[next.safety]}</span>}
        </div>
        <div class="genesis-ids">
          <code>{next.id}</code>
          {(next.migrationStepId || next.freedomTestStepId) && (
            <code>{next.migrationStepId ?? next.freedomTestStepId}</code>
          )}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

const MIGRATION_PHASES: readonly { label: string; phase: MigrationPhase }[] = [
  { label: "Inventory and custody", phase: "inventory" },
  { label: "Preservation and rollback", phase: "preservation" },
  { label: "Owner endpoint readiness", phase: "endpoint-readiness" },
  { label: "Observed online path", phase: "online-proof" },
];

export function MigrationPanel({ migration }: { migration: MigrationProjection }) {
  const [digests, setDigests] = useState<Record<string, string>>({});
  const [targetManifest, setTargetManifest] = useState("");
  const [targetManifestName, setTargetManifestName] = useState("");
  const [transport, setTransport] = useState<"internet-wss" | "isolated-lan-ws">("isolated-lan-ws");
  const [windowHours, setWindowHours] = useState("1");
  const [confirmation, setConfirmation] = useState("");
  const targetReady = targetManifest.length > 0 && targetManifest.length <= 6 * 1024;
  const authorizationReady =
    migration.preSwitchReady &&
    targetReady &&
    confirmation === MIGRATION_AUTHORIZATION_PHRASE &&
    action.value === null;
  const statusLabel = migrationStatusLabel(migration.status);

  return (
    <div class="section-stack">
      <header class="page-head with-actions">
        <div>
          <p class="page-kicker">Liberate my charger</p>
          <h1>{statusLabel}</h1>
          <p class="lede">{migration.disclaimer}</p>
        </div>
        <button
          class="button secondary"
          type="button"
          disabled={action.value !== null}
          onClick={() => void runMigrationReportExport()}
        >
          {action.value === "migration-export" ? "Exporting…" : "Export migration dossier"}
        </button>
      </header>

      <div class="migration-phases">
        {MIGRATION_PHASES.map(({ label, phase }, index) => {
          const steps = migration.steps.filter((step) => step.phase === phase);
          const done = steps.filter((step) => step.state === "pass").length;
          return (
            <section class="panel glass step-group" key={phase} aria-label={label}>
              <header class="step-group-head">
                <span class="phase-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h2>{label}</h2>
                  <small>
                    {phase === "online-proof"
                      ? "Derived only from protocol events after a valid owner-authorized change window."
                      : "Owner-recorded checks require a SHA-256 digest of separately held evidence."}
                  </small>
                </div>
                <span class="progress-count">
                  {done}/{steps.length}
                </span>
              </header>
              <ul class="step-list">
                {steps.map((step) => (
                  <MigrationStep
                    key={step.id}
                    step={step}
                    digest={digests[step.id] ?? ""}
                    onDigest={(value) =>
                      setDigests((current) => ({ ...current, [step.id]: value }))
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <form
        class={`panel glass authorization-gate ${migration.preSwitchReady ? "ready" : "locked"}`}
        onSubmit={(event) => {
          event.preventDefault();
          void runMigrationAuthorization({
            confirmation: MIGRATION_AUTHORIZATION_PHRASE,
            expiresAt: new Date(Date.now() + Number(windowHours) * 60 * 60 * 1000).toISOString(),
            targetManifest,
            transport,
          });
        }}
      >
        <header class="panel-head">
          <div>
            <p class="panel-kicker">Owner authorization gate</p>
            <h2>
              {migration.preSwitchReady
                ? "Pre-switch evidence is ready for explicit owner confirmation."
                : "Locked until every pre-switch checkpoint passes."}
            </h2>
          </div>
          <span
            class={`gate-lock ${migration.preSwitchReady ? "open" : "closed"}`}
            aria-hidden="true"
          />
        </header>
        <p class="panel-intro">
          Select the canonical file produced by <code>pnpm migration-manifest create</code>. The API
          validates its station, inventory, evidence hashes, transport, and safety boundary, then
          persists only its canonical hash. The file must never contain a station secret.
        </p>
        <div class="form-grid">
          <label class="manifest-field full-field">
            Canonical target manifest
            <input
              accept="application/json,.json"
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                setTargetManifestName(file?.name ?? "");
                setTargetManifest("");
                if (file) {
                  void file.text().then((contents) => {
                    setTargetManifest(contents);
                  });
                }
              }}
            />
            <span>{targetManifestName || "No manifest selected"}</span>
          </label>
          <label>
            Target transport
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.currentTarget.value as "internet-wss" | "isolated-lan-ws")
              }
            >
              <option value="isolated-lan-ws">Isolated LAN WS</option>
              <option value="internet-wss">Certificate-validated internet WSS</option>
            </select>
          </label>
          <label>
            Authorization window
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(event.currentTarget.value)}
            >
              <option value="1">1 hour</option>
              <option value="4">4 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
            </select>
          </label>
          <label class="confirmation-field full-field">
            Type this exact authorization phrase
            <span class="phrase">{MIGRATION_AUTHORIZATION_PHRASE}</span>
            <input
              value={confirmation}
              autocomplete="off"
              onInput={(event) => setConfirmation(event.currentTarget.value)}
            />
          </label>
        </div>
        <button class="button danger" type="submit" disabled={!authorizationReady}>
          {action.value === "migration-authorize"
            ? "Recording authorization…"
            : "Authorize documented endpoint-change window"}
        </button>
      </form>

      {migration.authorization && (
        <div
          class={`window-banner ${migration.authorization.validForChange ? "active" : "expired"}`}
          role="status"
        >
          <strong>
            {migration.authorization.validForChange
              ? "Owner authorization window is active"
              : "Owner authorization window expired"}
          </strong>
          <span>{migration.authorization.transport}</span>
          <span>Expires {formatDate(migration.authorization.expiresAt)}</span>
          <code>manifest sha256:{migration.authorization.targetManifestSha256}</code>
        </div>
      )}
    </div>
  );
}

function MigrationStep({
  step,
  digest,
  onDigest,
}: {
  step: MigrationStepResult;
  digest: string;
  onDigest(value: string): void;
}) {
  const digestReady = /^[a-fA-F0-9]{64}$/.test(digest);
  return (
    <li class={`step-row ${step.state}`}>
      <div class="step-summary">
        <span class={`step-mark ${step.state}`} aria-hidden="true" />
        <div>
          <strong>{step.label}</strong>
          <small>
            {step.source === "protocol-derived"
              ? "Derived from bounded protocol evidence"
              : step.source === "device-inventory"
                ? "Derived from the evidenced pre-switch device inventory"
                : "Owner-recorded external evidence"}
          </small>
        </div>
        <span class={`step-state ${step.state}`}>{step.state}</span>
      </div>
      {step.source === "owner-recorded" && (
        <div class="digest-controls">
          <label>
            <span class="visually-hidden">Evidence SHA-256 for {step.label}</span>
            <input
              value={digest}
              placeholder="Evidence SHA-256 (64 hex characters)"
              spellcheck={false}
              class="mono-input"
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <EvidenceFileDigest label={step.label} value={digest} onDigest={onDigest} />
          <button
            class="button secondary compact"
            type="button"
            aria-label={`Confirm checkpoint: ${step.label}`}
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runMigrationCheckpointSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "confirmed",
              })
            }
          >
            Confirm checkpoint
          </button>
          <button
            class="button danger-ghost compact"
            type="button"
            aria-label={`Record stop condition: ${step.label}`}
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runMigrationCheckpointSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "blocked",
              })
            }
          >
            Record stop
          </button>
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </li>
  );
}

export function migrationStatusLabel(status: MigrationProjection["status"]): string {
  if (status === "blocked") return "Stop condition recorded";
  if (status === "ready-for-owner-confirmation") return "Ready for owner confirmation";
  if (status === "owner-authorized-window") return "Owner-authorized window active";
  if (status === "online-proof-in-progress") return "Online proof in progress";
  if (status === "online-path-observed-unreviewed") return "Online path observed — review pending";
  if (status === "collecting") return "Collecting reversible-migration evidence";
  return "Migration dossier not started";
}

/* ------------------------------------------------------------------ */
/* Freedom Test                                                        */
/* ------------------------------------------------------------------ */

export function freedomStatusLabel(status: FreedomTestProjection["status"]): string {
  return status === "evidence-complete-unreviewed"
    ? "Evidence complete — review required"
    : status === "failed"
      ? "Failed observation recorded"
      : status === "baseline-stale"
        ? "Baseline changed — start a new field run"
        : status === "in-progress"
          ? "Field test in progress"
          : "Field test not started";
}

export function FreedomTestPanel({ test }: { test: FreedomTestProjection }) {
  const [runConfirmation, setRunConfirmation] = useState("");
  const [device, setDevice] = useState<FreedomTestDeviceInput>({
    articleNumber: test.device?.articleNumber ?? "",
    configurationPath: test.device?.configurationPath ?? "",
    connectivity: test.device?.connectivity ?? "ethernet",
    countryCode: test.device?.countryCode ?? "BE",
    evidenceSha256: test.device?.inventoryEvidenceSha256 ?? "",
    hardwareRevision: test.device?.hardwareRevision ?? "",
    inventoryFirmwareVersion: test.device?.inventoryFirmwareVersion ?? "",
    inventoryModel: test.device?.inventoryModel ?? "",
    inventoryVendor: test.device?.inventoryVendor ?? "",
    priorOperator: test.device?.priorOperator ?? "",
  });
  const [digests, setDigests] = useState<Record<string, string>>({});
  const statusLabel = freedomStatusLabel(test.status);
  const deviceReady =
    Object.values(device).every((value) => value.trim().length > 0) &&
    /^[a-fA-F0-9]{64}$/.test(device.evidenceSha256);
  const automaticReady =
    test.device?.identityMatch === "match" &&
    test.steps.filter((step) => step.source === "automatic").every((step) => step.state === "pass");
  const passed = test.steps.filter((step) => step.state === "pass").length;

  return (
    <div class="section-stack">
      <header class="page-head with-actions">
        <div>
          <p class="page-kicker">Freedom Test</p>
          <h1>{statusLabel}</h1>
          <p class="lede">{test.disclaimer}</p>
        </div>
        <div class="head-actions">
          <button
            class="button ghost"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFreedomReportExport()}
          >
            {action.value === "freedom-export" ? "Exporting…" : "Export unreviewed report"}
          </button>
          <button
            class="button secondary"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFieldPackExport()}
          >
            {action.value === "field-pack-export" ? "Packing…" : "Export field review pack"}
          </button>
        </div>
      </header>

      {test.run?.state !== "active" ? (
        <form
          class="panel glass authorization-gate"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomTestStart({ confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE });
          }}
        >
          <header class="panel-head">
            <div>
              <p class="panel-kicker">Witnessed run baseline</p>
              <h2>
                {test.run?.state === "stale"
                  ? "The device or authorized migration baseline changed. Old witnessed outcomes cannot carry forward."
                  : automaticReady
                    ? "Online evidence is ready to bind to a new physical field run."
                    : "Locked until the exact authorized device and all automatic online steps pass."}
              </h2>
            </div>
            <span class={`gate-lock ${automaticReady ? "open" : "closed"}`} aria-hidden="true" />
          </header>
          <div class="form-row">
            <label class="confirmation-field">
              Type this exact field-run phrase
              <span class="phrase">{FREEDOM_TEST_RUN_CONFIRMATION_PHRASE}</span>
              <input
                value={runConfirmation}
                autocomplete="off"
                onInput={(event) => setRunConfirmation(event.currentTarget.value)}
              />
            </label>
            <button
              class="button danger"
              type="submit"
              disabled={
                !automaticReady ||
                runConfirmation !== FREEDOM_TEST_RUN_CONFIRMATION_PHRASE ||
                action.value !== null
              }
            >
              {action.value === "freedom-run" ? "Starting field run…" : "Start bound field run"}
            </button>
          </div>
        </form>
      ) : (
        <div class="window-banner active" role="status">
          <strong>Witnessed field run active</strong>
          <span>Started {formatDate(test.run.startedAt)}</span>
          <code>run {test.run.runId}</code>
        </div>
      )}

      <div class="freedom-layout">
        <form
          class="panel glass device-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomDeviceSave(device);
          }}
        >
          <header class="panel-head">
            <div>
              <h2>Exact device identity</h2>
              <p class="panel-sub">
                Record label, ACE, or current-backend inventory before the switch. The first
                authorized Boot must match it exactly.
              </p>
            </div>
          </header>
          <div class="identity-compare">
            <div class="identity-card">
              <span>Pre-switch inventory</span>
              <strong>
                {device.inventoryVendor && device.inventoryModel
                  ? `${device.inventoryVendor} ${device.inventoryModel}`
                  : "Inventory not recorded"}
              </strong>
              <small>{device.inventoryFirmwareVersion || "Firmware not recorded"}</small>
            </div>
            <span
              class={`identity-link ${test.device?.identityMatch ?? "pending"}`}
              aria-hidden="true"
            />
            <div class="identity-card">
              <span>Observed boot identity</span>
              <strong>
                {test.device?.vendor && test.device.model
                  ? `${test.device.vendor} ${test.device.model}`
                  : "Awaiting BootNotification"}
              </strong>
              <small>{test.device?.firmwareVersion ?? "Firmware not observed"}</small>
            </div>
            <p class={`identity-verdict ${test.device?.identityMatch ?? "pending"}`}>
              {test.device?.identityMatch === "match"
                ? "Matches the authorized pre-switch inventory"
                : test.device?.identityMatch === "mismatch"
                  ? "Mismatch — stop and investigate before continuing"
                  : "Awaiting exact post-switch match"}
            </p>
          </div>
          <div class="form-grid">
            <label>
              Article number
              <input
                value={device.articleNumber}
                onInput={(event) =>
                  setDevice({ ...device, articleNumber: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Hardware revision
              <input
                value={device.hardwareRevision}
                onInput={(event) =>
                  setDevice({ ...device, hardwareRevision: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Country code
              <input
                value={device.countryCode}
                maxLength={2}
                onInput={(event) =>
                  setDevice({ ...device, countryCode: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Connectivity
              <select
                value={device.connectivity}
                onChange={(event) =>
                  setDevice({ ...device, connectivity: event.currentTarget.value })
                }
              >
                <option value="ethernet">Ethernet</option>
                <option value="wifi">Wi-Fi</option>
                <option value="cellular">Cellular</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Inventory vendor
              <input
                value={device.inventoryVendor}
                maxLength={20}
                onInput={(event) =>
                  setDevice({ ...device, inventoryVendor: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Inventory model
              <input
                value={device.inventoryModel}
                maxLength={20}
                onInput={(event) =>
                  setDevice({ ...device, inventoryModel: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Inventory firmware
              <input
                value={device.inventoryFirmwareVersion}
                maxLength={50}
                onInput={(event) =>
                  setDevice({ ...device, inventoryFirmwareVersion: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Prior operator
              <input
                value={device.priorOperator}
                onInput={(event) =>
                  setDevice({ ...device, priorOperator: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Endpoint configuration path
              <input
                value={device.configurationPath}
                onInput={(event) =>
                  setDevice({ ...device, configurationPath: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Inventory evidence SHA-256
              <input
                class="mono-input"
                value={device.evidenceSha256}
                placeholder="64-character digest"
                spellcheck={false}
                onInput={(event) => {
                  const evidenceSha256 = event.currentTarget.value.trim();
                  setDevice((current) => ({ ...current, evidenceSha256 }));
                }}
              />
            </label>
            <div class="full-field">
              <EvidenceFileDigest
                label="the device inventory"
                value={device.evidenceSha256}
                onDigest={(value) =>
                  setDevice((current) => ({ ...current, evidenceSha256: value }))
                }
              />
            </div>
          </div>
          <button
            class="button secondary"
            type="submit"
            disabled={!deviceReady || action.value !== null}
          >
            {action.value === "freedom-device" ? "Saving identity…" : "Save exact device identity"}
          </button>
        </form>

        <section class="panel glass step-group" aria-labelledby="freedom-steps-title">
          <header class="step-group-head">
            <div>
              <h2 id="freedom-steps-title">Versioned evidence steps</h2>
              <small>Witnessed steps require a SHA-256 digest of separately held evidence.</small>
            </div>
            <span class="progress-count">
              {passed}/{test.steps.length}
            </span>
          </header>
          <ul class="step-list">
            {test.steps.map((step) => (
              <FreedomStep
                key={step.id}
                step={step}
                runId={test.run?.state === "active" ? test.run.runId : null}
                digest={digests[step.id] ?? ""}
                onDigest={(value) => setDigests((current) => ({ ...current, [step.id]: value }))}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FreedomStep({
  step,
  runId,
  digest,
  onDigest,
}: {
  step: FreedomTestStepResult;
  runId: string | null;
  digest: string;
  onDigest(value: string): void;
}) {
  const digestReady = /^[a-fA-F0-9]{64}$/.test(digest);
  return (
    <li class={`step-row ${step.state}`}>
      <div class="step-summary">
        <span class={`step-mark ${step.state}`} aria-hidden="true" />
        <div>
          <strong>{step.label}</strong>
          <small>
            {step.source === "automatic"
              ? "Derived from protocol evidence"
              : "Witnessed physical observation"}
          </small>
        </div>
        <span class={`step-state ${step.state}`}>{step.state}</span>
      </div>
      {step.source === "witnessed" && runId && (
        <div class="digest-controls">
          <label>
            <span class="visually-hidden">Evidence SHA-256 for {step.label}</span>
            <input
              value={digest}
              placeholder="Evidence SHA-256 (64 hex characters)"
              spellcheck={false}
              class="mono-input"
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <EvidenceFileDigest label={step.label} value={digest} onDigest={onDigest} />
          <button
            class="button secondary compact"
            type="button"
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runFreedomObservationSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "pass",
                runId,
              })
            }
          >
            Record pass
          </button>
          <button
            class="button danger-ghost compact"
            type="button"
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runFreedomObservationSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "fail",
                runId,
              })
            }
          >
            Record failure
          </button>
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </li>
  );
}
