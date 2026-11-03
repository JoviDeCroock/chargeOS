import { useState } from "preact/hooks";

import type { OwnerSnapshot, SetupStep, SetupStepId } from "../../shared/contracts.js";
import { DIRECTORY_NAME_MAX_LENGTH, type OwnerDirectory } from "../../shared/directory.js";
import {
  EXPECTED_IDENTITY_MAX_LENGTH,
  retirementPhrase,
  type StationOwnership,
} from "../../shared/stations.js";
import {
  runAddStation,
  runReissuePassword,
  runRetireStation,
  setupSheet,
  stationRegistry,
} from "../fleet-model.js";
import { formatDate, t, type MessageKey } from "../i18n/index.js";
import {
  action,
  fleet,
  refreshSnapshot,
  runAuthorizationSync,
  runInspection,
  selectStation,
} from "../model.js";
import type { Route } from "../routes.js";
import { Dialog, PersonSelect } from "../ui.js";

/* ------------------------------------------------------------------ */
/* Add a charger                                                       */
/* ------------------------------------------------------------------ */

export function AddChargerDialog({
  directory,
  onClose,
  onAdded,
}: {
  directory: OwnerDirectory | null;
  onClose: () => void;
  onAdded: (stationId: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [site, setSite] = useState("");
  const [driver, setDriver] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<StationOwnership>("company");
  const [chargerId, setChargerId] = useState("");
  const [checkIdentity, setCheckIdentity] = useState(false);
  const [vendor, setVendor] = useState("");
  const [model, setModel] = useState("");
  const [firmware, setFirmware] = useState("");
  const limit = stationRegistry.value?.connectionLimit ?? null;
  const count = fleet.value?.stations.length ?? 0;
  const valid =
    label.trim().length > 0 &&
    site.trim().length > 0 &&
    (!checkIdentity || (vendor.trim().length > 0 && model.trim().length > 0));
  return (
    <Dialog title={t("fleet.add.title")} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runAddStation({
            driverPersonId: driver,
            expected: checkIdentity
              ? {
                  firmwareVersion: firmware.trim() || null,
                  model: model.trim(),
                  vendor: vendor.trim(),
                }
              : null,
            id: chargerId.trim() || null,
            label,
            ownership,
            site,
          }).then((stationId) => stationId && onAdded(stationId));
        }}
      >
        <p class="dialog-lede">{t("fleet.add.lede")}</p>
        <label>
          {t("stations.field.name")}
          <input
            value={label}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            placeholder={t("stations.field.namePlaceholder")}
            onInput={(event) => setLabel(event.currentTarget.value)}
          />
        </label>
        <label>
          {t("stations.field.site")}
          <input
            value={site}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            placeholder={t("stations.field.sitePlaceholder")}
            onInput={(event) => setSite(event.currentTarget.value)}
          />
        </label>
        {directory && (
          <PersonSelect
            label={t("stations.field.driver")}
            value={driver}
            onChange={setDriver}
            people={directory.people}
          />
        )}
        <fieldset class="choice-group">
          <legend>{t("fleet.ownership.question")}</legend>
          {(["company", "employee"] as const).map((value) => (
            <label key={value} class={`choice${ownership === value ? " selected" : ""}`}>
              <input
                type="radio"
                name="ownership"
                checked={ownership === value}
                onChange={() => setOwnership(value)}
              />
              <span>
                <strong>{t(`fleet.ownership.${value}` as MessageKey)}</strong>
                <small>{t(`fleet.ownership.${value}Hint` as MessageKey)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <details class="dialog-more">
          <summary>{t("fleet.add.more")}</summary>
          <label>
            {t("fleet.add.chargerId")}
            <input
              value={chargerId}
              maxLength={64}
              spellcheck={false}
              autocomplete="off"
              placeholder={t("fleet.add.chargerIdPlaceholder")}
              onInput={(event) => setChargerId(event.currentTarget.value)}
            />
          </label>
          <p class="field-hint">{t("fleet.add.chargerIdHint")}</p>
          <label class="check-field">
            <input
              type="checkbox"
              checked={checkIdentity}
              onChange={(event) => setCheckIdentity(event.currentTarget.checked)}
            />
            <span>{t("fleet.add.checkIdentity")}</span>
          </label>
          {checkIdentity && (
            <div class="field-row">
              <label>
                {t("fleet.add.vendor")}
                <input
                  value={vendor}
                  maxLength={EXPECTED_IDENTITY_MAX_LENGTH}
                  placeholder="Alfen BV"
                  onInput={(event) => setVendor(event.currentTarget.value)}
                />
              </label>
              <label>
                {t("fleet.add.model")}
                <input
                  value={model}
                  maxLength={EXPECTED_IDENTITY_MAX_LENGTH}
                  placeholder="Eve Single Pro-line"
                  onInput={(event) => setModel(event.currentTarget.value)}
                />
              </label>
              <label>
                {t("fleet.add.firmware")}
                <input
                  value={firmware}
                  maxLength={EXPECTED_IDENTITY_MAX_LENGTH}
                  placeholder={t("fleet.add.firmwareOptional")}
                  onInput={(event) => setFirmware(event.currentTarget.value)}
                />
              </label>
            </div>
          )}
        </details>
        {limit !== null && count >= limit && (
          <p class="inline-alert warn">{t("fleet.add.limit", { limit })}</p>
        )}
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" type="submit" disabled={!valid || action.value !== null}>
            {t("fleet.add.submit")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

/**
 * The installer's setup sheet. The password is shown here once; chargeOS keeps it to check the
 * charger, but never shows it again.
 */
export function SetupSheetDialog({ label, onClose }: { label: string; onClose: () => void }) {
  const sheet = setupSheet.value;
  const [copied, setCopied] = useState(false);
  if (!sheet) return null;
  const close = () => {
    setupSheet.value = null;
    onClose();
  };
  return (
    <Dialog title={t("fleet.sheet.title", { name: label })} onClose={close}>
      <p class="dialog-lede">{t("fleet.sheet.lede")}</p>
      <div class="setup-ticket">
        <dl>
          <div>
            <dt>{t("fleet.sheet.address")}</dt>
            <dd class="mono">{sheet.endpoint ?? t("fleet.sheet.addressUnknown")}</dd>
          </div>
          <div>
            <dt>{t("fleet.sheet.chargerId")}</dt>
            <dd class="mono">{sheet.stationId}</dd>
          </div>
          <div class="ticket-secret">
            <dt>{t("fleet.sheet.password")}</dt>
            <dd class="mono">{sheet.password}</dd>
          </div>
          <div>
            <dt>{t("fleet.sheet.protocol")}</dt>
            <dd>{t("fleet.sheet.protocolValue")}</dd>
          </div>
        </dl>
      </div>
      <p class="inline-alert warn">{t("fleet.sheet.once")}</p>
      <p class="fine-print">{t("fleet.sheet.installer")}</p>
      <footer class="dialog-actions">
        <button
          class="button secondary"
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(
                [
                  `${t("fleet.sheet.address")}: ${sheet.endpoint ?? "—"}`,
                  `${t("fleet.sheet.chargerId")}: ${sheet.stationId}`,
                  `${t("fleet.sheet.password")}: ${sheet.password}`,
                  `${t("fleet.sheet.protocol")}: ${t("fleet.sheet.protocolValue")}`,
                ].join("\n"),
              )
              .then(() => setCopied(true));
          }}
        >
          {copied ? t("fleet.sheet.copied") : t("fleet.sheet.copy")}
        </button>
        <button class="button primary" type="button" onClick={close}>
          {t("fleet.sheet.done")}
        </button>
      </footer>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Setup checklist                                                     */
/* ------------------------------------------------------------------ */

const STEP_TEXT: Readonly<Record<SetupStepId, { title: MessageKey; body: MessageKey }>> = {
  cards: { body: "fleet.step.cards.body", title: "fleet.step.cards.title" },
  "cards-on-charger": {
    body: "fleet.step.cards-on-charger.body",
    title: "fleet.step.cards-on-charger.title",
  },
  connected: { body: "fleet.step.connected.body", title: "fleet.step.connected.title" },
  identity: { body: "fleet.step.identity.body", title: "fleet.step.identity.title" },
  "offline-ready": {
    body: "fleet.step.offline-ready.body",
    title: "fleet.step.offline-ready.title",
  },
  "test-charge": { body: "fleet.step.test-charge.body", title: "fleet.step.test-charge.title" },
};

const DETAIL_TEXT: Readonly<Record<NonNullable<SetupStep["detail"]>, MessageKey>> = {
  "identity-mismatch": "fleet.detail.identity-mismatch",
  "identity-unchecked": "fleet.detail.identity-unchecked",
  "readiness-blocked": "fleet.detail.readiness-blocked",
  "restart-required": "fleet.detail.restart-required",
  "sync-rejected": "fleet.detail.sync-rejected",
};

const SETUP_DONE_VISIBLE_MS = 24 * 60 * 60 * 1_000;

export function SetupChecklist({
  snapshot: current,
  go,
  onRegisterCard,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
  onRegisterCard: () => void;
}) {
  const setup = current.setup;
  if (!setup) return null;
  const station = current.station;
  if (setup.state === "active") {
    const finished = setup.completedAt ? Date.parse(setup.completedAt) : Number.NaN;
    if (!(Date.now() - finished < SETUP_DONE_VISIBLE_MS)) return null;
    return (
      <section class="panel glass setup-panel setup-done" aria-labelledby="setup-title">
        <span class="setup-done-mark" aria-hidden="true" />
        <div>
          <h2 id="setup-title">{t("fleet.setup.done.title", { name: station.label })}</h2>
          <p class="panel-sub">
            {t("fleet.setup.done.body", { time: formatDate(setup.completedAt) })}
          </p>
        </div>
      </section>
    );
  }
  const done = setup.steps.filter(({ state }) => state === "done").length;
  const steps = (
    <ol class="setup-steps">
      {setup.steps.map((step) => (
        <li key={step.id} class={`setup-step ${step.state}`}>
          <span class="setup-node" aria-hidden="true" />
          <div class="setup-copy">
            <strong>{t(STEP_TEXT[step.id].title)}</strong>
            {step.state !== "done" && <p>{t(STEP_TEXT[step.id].body)}</p>}
            {step.id === "identity" && station.boot && (
              <p class="setup-identity">
                {t("fleet.setup.reported", {
                  firmware: station.boot.firmwareVersion ?? "—",
                  model: station.boot.model,
                  vendor: station.boot.vendor,
                })}
                {station.expected && (
                  <>
                    <br />
                    {t("fleet.setup.expected", {
                      firmware: station.expected.firmwareVersion ?? t("fleet.setup.anyFirmware"),
                      model: station.expected.model,
                      vendor: station.expected.vendor,
                    })}
                  </>
                )}
              </p>
            )}
            {step.detail && step.state !== "done" && (
              <p class={step.state === "stopped" ? "setup-stop" : "setup-detail"}>
                {t(DETAIL_TEXT[step.detail])}
              </p>
            )}
            {step.detail === "identity-unchecked" && step.state === "done" && (
              <p class="setup-detail">{t(DETAIL_TEXT[step.detail])}</p>
            )}
            {step.state === "current" && (
              <StepAction
                step={step.id}
                snapshot={current}
                go={go}
                onRegisterCard={onRegisterCard}
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
  if (!station.connected && !station.boot && setup.state === "waiting-for-charger") {
    return (
      <details class="panel glass overview-setup">
        <summary>
          <strong>{t("fleet.setup.title")}</strong>
          <span>{t("fleet.setup.progress", { done, total: setup.steps.length })}</span>
        </summary>
        {steps}
      </details>
    );
  }
  return (
    <section class="panel glass setup-panel" aria-labelledby="setup-title">
      <header class="panel-head">
        <div>
          <h2 id="setup-title">{t("fleet.setup.title")}</h2>
          <p class="panel-sub">{t("fleet.setup.progress", { done, total: setup.steps.length })}</p>
        </div>
        <span
          class={`state-chip ${setup.state === "stopped" ? "risk" : setup.state === "waiting-for-charger" ? "idle" : "warn"}`}
        >
          {t(`fleet.setup.state.${setup.state}` as MessageKey)}
        </span>
      </header>
      {steps}
    </section>
  );
}

function StepAction({
  step,
  snapshot: current,
  go,
  onRegisterCard,
}: {
  step: SetupStepId;
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
  onRegisterCard: () => void;
}) {
  if (step === "connected" && current.station.managed) {
    return (
      <div class="setup-actions">
        <button
          class="button ghost compact"
          type="button"
          disabled={action.value !== null}
          onClick={() => {
            if (window.confirm(t("fleet.setup.reissueConfirm"))) {
              void runReissuePassword(current.station.id);
            }
          }}
        >
          {t("fleet.setup.reissue")}
        </button>
      </div>
    );
  }
  if (step === "offline-ready") {
    // Checking only reads the charger's settings; preparing it stays on the offline page.
    return (
      <div class="setup-actions">
        <button
          class="button primary compact"
          type="button"
          disabled={!current.station.connected || action.value !== null}
          onClick={() => void runInspection()}
        >
          {action.value === "inspect" ? t("offline.checking") : t("offline.check")}
        </button>
        <button
          class="button ghost compact"
          type="button"
          onClick={() => go({ page: "advanced", tab: "offline" })}
        >
          {t("fleet.setup.offlineDetails")}
        </button>
      </div>
    );
  }
  if (step === "cards") {
    return (
      <div class="setup-actions">
        <button
          class="button primary compact"
          type="button"
          disabled={!current.station.connected}
          onClick={onRegisterCard}
        >
          {t("fleet.capture.start")}
        </button>
        <button class="button ghost compact" type="button" onClick={() => go({ page: "cards" })}>
          {t("fleet.setup.otherWays")}
        </button>
      </div>
    );
  }
  if (step === "cards-on-charger") {
    return (
      <div class="setup-actions">
        <button
          class="button primary compact"
          type="button"
          disabled={!current.station.connected || action.value !== null}
          onClick={() => void runAuthorizationSync()}
        >
          {action.value === "sync" ? t("cards.sync.sending") : t("cards.sync.send")}
        </button>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Retire a charger                                                    */
/* ------------------------------------------------------------------ */

export function RetireChargerDialog({
  stationId,
  label,
  onClose,
}: {
  stationId: string;
  label: string;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const phrase = retirementPhrase(stationId);
  return (
    <Dialog title={t("fleet.retire.title", { name: label })} onClose={onClose}>
      <p>{t("fleet.retire.body")}</p>
      <p class="inline-alert warn">{t("fleet.retire.cards")}</p>
      <label class="dialog-form">
        {t("fleet.retire.type", { phrase })}
        <input
          value={typed}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
      </label>
      <footer class="dialog-actions">
        <button class="button ghost" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          class="button danger"
          type="button"
          disabled={typed !== phrase || action.value !== null}
          onClick={() =>
            void runRetireStation(stationId, typed).then((done) => {
              if (!done) return;
              const next = fleet.value?.stations[0]?.id;
              if (next) {
                selectStation(next);
                void refreshSnapshot(false);
              }
              onClose();
            })
          }
        >
          {t("fleet.retire.confirm")}
        </button>
      </footer>
    </Dialog>
  );
}
