import { useEffect, useState } from "preact/hooks";

import type { CardCaptureProjection, OwnerSnapshot } from "../../shared/contracts.js";
import { DIRECTORY_NAME_MAX_LENGTH, type OwnerDirectory } from "../../shared/directory.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../../shared/owner-tags.js";
import { formatTime, t, tn } from "../i18n/index.js";
import {
  action,
  pollSnapshot,
  runAuthorizationSync,
  runCardCapture,
  runCardCaptureConfirm,
  runOwnerTagAdd,
  runOwnerTagRevoke,
  runSaveCard,
} from "../model.js";
import type { Route } from "../routes.js";
import { cardLabel, closeRowMenu, Dialog, PageHead, PersonSelect, shortPseudonym } from "../ui.js";
import { fleetCards, refreshFleetCards } from "../fleet-model.js";
import { fleet as fleetSignal } from "../model.js";
import type { MessageKey } from "../i18n/index.js";
import type { CardOwnership, CardUse } from "../../shared/cards.js";
import { setFleetCardPolicy } from "../fleet-client.js";
import {
  CardPolicyFields,
  ClassifyCardDialog,
  CopyCardDialog,
  LostCardDialog,
} from "./register-card.js";

type Editing =
  | { readonly kind: "add" }
  | { readonly kind: "tap" }
  | { readonly kind: "classify"; readonly tagPseudonym: string }
  | { readonly kind: "copy"; readonly tagPseudonym: string }
  | { readonly kind: "lost"; readonly tagPseudonym: string }
  | { readonly kind: "edit"; readonly tagPseudonym: string }
  | { readonly kind: "remove"; readonly tagPseudonym: string };

export function CardsPage({
  snapshot: current,
  directory,
  go,
  company = false,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  go: (next: Route) => void;
  company?: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const authorization = current.authorization;
  const stationId = current.station.id;
  const multipleChargers = (fleetSignal.value?.stations.length ?? 0) > 1;
  useEffect(() => {
    if (multipleChargers) void refreshFleetCards();
  }, [stationId, multipleChargers, authorization.lastSyncRevision]);
  const canName = Boolean(directory?.writable);
  const unnamedCount = authorization.tagPseudonyms.filter(
    (tag) => !cardLabel(directory, stationId, tag).named,
  ).length;

  return (
    <div class="section-stack">
      <PageHead
        title={t("cards.title")}
        lede={
          current.station.label === current.station.id
            ? t("cards.ledeThis")
            : t("cards.lede", { station: current.station.label })
        }
        actions={
          // Header actions stay secondary; the page's next step below is the one primary button.
          <button
            class="button secondary"
            type="button"
            onClick={() => setEditing({ kind: "tap" })}
          >
            {t("cards.add")}
          </button>
        }
      />

      {authorization.tagCount === 0 ? (
        <section class="panel glass first-card" aria-labelledby="first-card-title">
          <h2 id="first-card-title">{t("cards.first.title")}</h2>
          <p>{t("cards.first.body")}</p>
          <button class="button primary" type="button" onClick={() => setEditing({ kind: "tap" })}>
            {t("cards.tap.start")}
          </button>
        </section>
      ) : (
        <SyncBanner snapshot={current} go={go} />
      )}

      {authorization.pendingRevocations.length > 0 && (
        <div class="inline-alert risk" role="alert">
          <strong>{tn("cards.staleTitle", authorization.pendingRevocations.length)}</strong>
          <p>{t("cards.staleBody")}</p>
        </div>
      )}

      <section class="panel glass" aria-labelledby="card-list-title">
        <header class="panel-head">
          <h2 id="card-list-title">{tn("cards.count", authorization.tagCount)}</h2>
        </header>
        <ul class="card-list">
          {authorization.tagPseudonyms.map((tag) => {
            const card = cardLabel(directory, stationId, tag);
            const onCharger = authorization.acknowledgedTagPseudonyms.includes(tag);
            const policy = current.cardPolicies?.find(({ tagPseudonym }) => tagPseudonym === tag);
            // The same physical card on other chargers, recognised on the server without its number.
            const elsewhere = cardMembers(stationId, tag).filter(
              (member) => member.stationId !== stationId,
            );
            return (
              <li key={tag} class="card-row">
                <span class="rfid-chip" aria-hidden="true" />
                <div class="card-main">
                  <strong>{card.named ? card.name : t("cards.unnamed")}</strong>
                  <small>
                    {card.holder ?? <span class="muted">{t("cards.noPerson")}</span>}
                    {/* A short reference only where it tells two unnamed cards apart. */}
                    {!card.named && unnamedCount > 1 && (
                      <span class="card-ref">
                        {t("cards.reference", { id: shortPseudonym(tag) })}
                      </span>
                    )}
                  </small>
                  {elsewhere.map((member) => (
                    <small key={member.stationId} class="card-also">
                      {t(member.onCharger ? "fleet.cards.alsoAccepted" : "fleet.cards.alsoAt", {
                        station:
                          fleetSignal.value?.stations.find(({ id }) => id === member.stationId)
                            ?.label ?? member.stationId,
                      })}
                    </small>
                  ))}
                </div>
                <span class="card-tags">
                  {policy ? (
                    <>
                      <span class={`label-chip ${policy.ownership}`}>
                        {t(`fleet.card.ownership.${policy.ownership}` as MessageKey)}
                      </span>
                      <span class={`label-chip ${policy.use}`}>
                        {t(`fleet.card.use.${policy.use}` as MessageKey)}
                      </span>
                    </>
                  ) : (
                    // Classification only matters for employee and finance reports.
                    current.cardPolicies &&
                    company && <span class="label-chip unset">{t("fleet.card.unclassified")}</span>
                  )}
                </span>
                {/* The page banner explains pending delivery; the row stays neutral. */}
                <span class={`state-chip ${onCharger ? "ok" : "idle"}`}>
                  {t(onCharger ? "cards.onCharger" : "cards.waiting")}
                </span>
                <div class="card-actions">
                  {canName && (
                    <button
                      class="button secondary compact"
                      type="button"
                      onClick={() => setEditing({ kind: "edit", tagPseudonym: tag })}
                    >
                      {t(card.named ? "common.edit" : "cards.addName")}
                    </button>
                  )}
                  {current.cardPolicies ? (
                    <details class="row-menu">
                      <summary class="button ghost compact">{t("fleet.cards.more")}</summary>
                      <div class="row-menu-list glass" onClickCapture={closeRowMenu}>
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: "classify", tagPseudonym: tag })}
                        >
                          {t("fleet.cards.classify")}
                        </button>
                        {(fleetSignal.value?.stations.length ?? 0) > 1 && (
                          <button
                            type="button"
                            onClick={() => setEditing({ kind: "copy", tagPseudonym: tag })}
                          >
                            {t("fleet.cards.copy")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={authorization.tagCount <= 1}
                          onClick={() => setEditing({ kind: "remove", tagPseudonym: tag })}
                        >
                          {t("fleet.cards.removeHere")}
                        </button>
                        <button
                          type="button"
                          class="danger"
                          onClick={() => setEditing({ kind: "lost", tagPseudonym: tag })}
                        >
                          {t("fleet.cards.lost")}
                        </button>
                      </div>
                    </details>
                  ) : (
                    <button
                      class="button danger-ghost compact"
                      type="button"
                      disabled={authorization.tagCount <= 1 || action.value !== null}
                      title={authorization.tagCount <= 1 ? t("cards.keepOne") : undefined}
                      onClick={() => setEditing({ kind: "remove", tagPseudonym: tag })}
                    >
                      {t("common.remove")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {authorization.tagCount === 1 && <p class="fine-print">{t("cards.keepOne")}</p>}
      </section>

      <p class="fine-print">{t("cards.privacy")}</p>

      {editing?.kind === "tap" && (
        <TapCardDialog
          capture={current.cardCapture}
          connected={current.station.connected}
          directory={directory}
          stationLabel={current.station.label}
          onClose={() => setEditing(null)}
          onType={() => setEditing({ kind: "add" })}
        />
      )}
      {editing?.kind === "add" && (
        <AddCardDialog
          directory={directory}
          stationLabel={current.station.label}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "edit" && directory && (
        <EditCardDialog
          directory={directory}
          stationId={stationId}
          tagPseudonym={editing.tagPseudonym}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "classify" && (
        <ClassifyCardDialog
          stationId={stationId}
          tagPseudonym={editing.tagPseudonym}
          name={cardLabel(directory, stationId, editing.tagPseudonym).name}
          initial={
            current.cardPolicies?.find(
              ({ tagPseudonym }) => tagPseudonym === editing.tagPseudonym,
            ) ?? null
          }
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "copy" && fleetSignal.value && (
        <CopyCardDialog
          stationId={stationId}
          tagPseudonym={editing.tagPseudonym}
          name={cardLabel(directory, stationId, editing.tagPseudonym).name}
          fleet={fleetSignal.value}
          presentOn={presentOn(stationId, editing.tagPseudonym)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "lost" && (
        <LostCardDialog
          stationId={stationId}
          tagPseudonym={editing.tagPseudonym}
          name={cardLabel(directory, stationId, editing.tagPseudonym).name}
          stationLabels={presentOn(stationId, editing.tagPseudonym)
            .filter((id) => !isOnlyCard(id))
            .map(stationLabel)}
          keptLabels={presentOn(stationId, editing.tagPseudonym)
            .filter(isOnlyCard)
            .map(stationLabel)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "remove" && (
        <RemoveCardDialog
          name={cardLabel(directory, stationId, editing.tagPseudonym).name}
          tagPseudonym={editing.tagPseudonym}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SyncBanner({
  snapshot: current,
  go,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
}) {
  const authorization = current.authorization;
  const ready = current.readiness?.state === "ready";
  const connected = current.station.connected;
  if (authorization.syncState === "current") {
    return (
      <div class="sync-banner current">
        <span class="sync-icon" aria-hidden="true" />
        <strong>{t("cards.sync.currentLong")}</strong>
      </div>
    );
  }
  const waiting = authorization.pendingAdditions.length + authorization.pendingRevocations.length;
  return (
    <div class={`sync-banner ${authorization.syncState} with-action`}>
      <span class="sync-icon" aria-hidden="true" />
      <div>
        <strong>
          {authorization.syncState === "never-synced"
            ? t(
                authorization.lastAttemptRevision === null && authorization.pendingRevision === null
                  ? "cards.sync.notSent"
                  : "cards.sync.neverLong",
              )
            : tn("cards.sync.pendingLong", Math.max(waiting, 1))}
        </strong>
        <p>
          {!connected
            ? t("cards.sync.offline")
            : ready
              ? t("cards.sync.readyHint")
              : t("cards.sync.checkFirst")}
        </p>
      </div>
      {ready ? (
        <button
          class="button primary"
          type="button"
          disabled={!connected || action.value !== null}
          onClick={() => {
            if (window.confirm(t("cards.sync.confirm"))) void runAuthorizationSync();
          }}
        >
          {action.value === "sync" ? t("cards.sync.sending") : t("cards.sync.send")}
        </button>
      ) : (
        <button
          class="button primary"
          type="button"
          onClick={() => go({ page: "advanced", tab: "offline" })}
        >
          {t("cards.sync.openOffline")}
        </button>
      )}
    </div>
  );
}

const CAPTURE_POLL_MS = 2_000;

/**
 * Adds a card by tapping it at the charger. chargeOS listens for one tap, the charger refuses that
 * tap as usual, and the console offers the card it saw by its reference only.
 */
export function TapCardDialog({
  capture: serverCapture,
  connected,
  directory,
  stationLabel,
  onClose,
  onType,
}: {
  capture: CardCaptureProjection | undefined;
  connected: boolean;
  directory: OwnerDirectory | null;
  stationLabel: string;
  onClose: () => void;
  onType: () => void;
}) {
  const capture = serverCapture ?? {
    state: "idle",
    tagPseudonym: null,
    tappedAt: null,
    until: null,
  };
  const [profile, setProfile] = useState<CardProfileState>(EMPTY_PROFILE);
  const [ownership, setOwnership] = useState<CardOwnership>("company");
  const [use, setUse] = useState<CardUse>("business");
  // A company records who owns each card and whether its sessions are business charging.
  const company = fleetSignal.value?.console?.profile === "company";
  const listening = capture.state === "listening";

  useEffect(() => {
    if (!listening) return undefined;
    const timer = setInterval(() => void pollSnapshot(), CAPTURE_POLL_MS);
    return () => clearInterval(timer);
  }, [listening]);

  const close = () => {
    // Stop listening and let the server forget any tapped card the owner did not add.
    if (capture.state !== "idle") void runCardCapture(false);
    onClose();
  };
  const start = () => void runCardCapture(true);

  return (
    <Dialog title={t("cards.addTitle", { station: stationLabel })} onClose={close}>
      <div class="dialog-form tap-card" aria-live="polite">
        {capture.state === "idle" && (
          <>
            <p>{t("cards.tap.intro")}</p>
            {!connected && <p class="inline-alert warn">{t("cards.tap.offline")}</p>}
          </>
        )}
        {listening && (
          <div class="tap-listening" role="status">
            <span class="charging-pulse" aria-hidden="true" />
            <div>
              <strong>{t("cards.tap.listening")}</strong>
              <p>{t("cards.tap.listeningBody")}</p>
              {capture.until && (
                <small>{t("cards.tap.until", { time: formatTime(capture.until) })}</small>
              )}
            </div>
          </div>
        )}
        {capture.state === "captured" && capture.tagPseudonym && (
          <>
            <div class="inline-alert idle" role="status">
              <strong>{t("cards.tap.captured")}</strong>
              <p>
                {t("cards.tap.capturedBody", {
                  reference: shortPseudonym(capture.tagPseudonym),
                  time: capture.tappedAt ? formatTime(capture.tappedAt) : "—",
                })}
              </p>
            </div>
            <CardProfileFields directory={directory} value={profile} onChange={setProfile} />
            {company && (
              <CardPolicyFields
                ownership={ownership}
                use={use}
                onOwnership={setOwnership}
                onUse={setUse}
              />
            )}
            <p class="field-hint">{t("cards.addHint")}</p>
          </>
        )}
        {capture.state === "known" && (
          <p class="inline-alert idle" role="status">
            {t("cards.tap.known")}
          </p>
        )}
        {capture.state === "several" && (
          <p class="inline-alert warn" role="status">
            {t("cards.tap.several")}
          </p>
        )}
        {capture.state === "expired" && (
          <p class="inline-alert warn" role="status">
            {t("cards.tap.expired")}
          </p>
        )}
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onType}>
            {t("cards.tap.typeInstead")}
          </button>
          {capture.state === "captured" && capture.tagPseudonym ? (
            <button
              class="button primary"
              type="button"
              disabled={action.value !== null}
              onClick={() =>
                void runCardCaptureConfirm(
                  capture.tagPseudonym!,
                  directory?.writable ? profileInput(profile) : undefined,
                  company
                    ? (stationId, tagPseudonym, token) =>
                        setFleetCardPolicy({ stationId, tagPseudonym }, ownership, use, token).then(
                          (cards) => {
                            fleetCards.value = cards;
                          },
                        )
                    : undefined,
                ).then((added) => added && onClose())
              }
            >
              {action.value === "owner-tag-add" ? t("cards.adding") : t("cards.tap.add")}
            </button>
          ) : listening ? (
            <button class="button secondary" type="button" onClick={close}>
              {t("common.cancel")}
            </button>
          ) : (
            <button
              class="button primary"
              type="button"
              disabled={!connected || action.value !== null}
              onClick={start}
            >
              {capture.state === "idle" ? t("cards.tap.start") : t("cards.tap.again")}
            </button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}

interface CardProfileState {
  readonly holder: string | null;
  readonly name: string;
  readonly newPerson: string;
}

const EMPTY_PROFILE: CardProfileState = { holder: null, name: "", newPerson: "" };

function profileInput(profile: CardProfileState) {
  const newHolderName = profile.holder === "new" ? profile.newPerson.trim() : "";
  return {
    holderPersonId: profile.holder === "new" ? null : profile.holder,
    name: profile.name.trim() || null,
    ...(newHolderName ? { newHolderName } : {}),
  };
}

/** Optional card name and holder, shared by both ways of adding a card. */
function CardProfileFields({
  directory,
  value,
  onChange,
}: {
  directory: OwnerDirectory | null;
  value: CardProfileState;
  onChange: (next: CardProfileState) => void;
}) {
  if (!directory?.writable) return null;
  return (
    <>
      <label>
        {t("cards.field.name")}
        <input
          value={value.name}
          maxLength={DIRECTORY_NAME_MAX_LENGTH}
          placeholder={t("cards.field.namePlaceholder")}
          onInput={(event) => onChange({ ...value, name: event.currentTarget.value })}
        />
      </label>
      <label>
        {t("cards.field.holder")}
        <select
          value={value.holder ?? ""}
          onChange={(event) => onChange({ ...value, holder: event.currentTarget.value || null })}
        >
          <option value="">{t("people.nobody")}</option>
          {directory.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="new">{t("cards.field.newPerson")}</option>
        </select>
      </label>
      {value.holder === "new" && (
        <label>
          {t("people.field.name")}
          <input
            value={value.newPerson}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            onInput={(event) => onChange({ ...value, newPerson: event.currentTarget.value })}
          />
        </label>
      )}
    </>
  );
}

function AddCardDialog({
  directory,
  stationLabel,
  onClose,
}: {
  directory: OwnerDirectory | null;
  stationLabel: string;
  onClose: () => void;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [profile, setProfile] = useState<CardProfileState>(EMPTY_PROFILE);
  const valid =
    cardNumber.length > 0 && cardNumber.length <= 20 && cardNumber.trim() === cardNumber;
  return (
    <Dialog title={t("cards.addTitle", { station: stationLabel })} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const added = await runOwnerTagAdd(
              { tag: cardNumber },
              directory?.writable ? profileInput(profile) : undefined,
            );
            // The raw card number never outlives the request in this browser.
            setCardNumber("");
            if (added) onClose();
          })();
        }}
      >
        <label>
          {t("cards.field.number")}
          <input
            value={cardNumber}
            type="password"
            maxLength={20}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setCardNumber(event.currentTarget.value)}
          />
        </label>
        <p class="field-hint">{t("cards.field.numberHint")}</p>
        <CardProfileFields directory={directory} value={profile} onChange={setProfile} />
        <p class="field-hint">{t("cards.addHint")}</p>
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" type="submit" disabled={!valid || action.value !== null}>
            {action.value === "owner-tag-add" ? t("cards.adding") : t("cards.add")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function EditCardDialog({
  directory,
  stationId,
  tagPseudonym,
  onClose,
}: {
  directory: OwnerDirectory;
  stationId: string;
  tagPseudonym: string;
  onClose: () => void;
}) {
  const card = directory.cards.find(
    (candidate) => candidate.stationId === stationId && candidate.tagPseudonym === tagPseudonym,
  );
  const [name, setName] = useState(card?.name ?? "");
  const [holder, setHolder] = useState<string | null>(card?.holderPersonId ?? null);
  return (
    <Dialog title={t("cards.editTitle")} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSaveCard(stationId, tagPseudonym, {
            holderPersonId: holder,
            name: name.trim() || null,
          }).then((saved) => saved && onClose());
        }}
      >
        <label>
          {t("cards.field.name")}
          <input
            value={name}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            placeholder={t("cards.field.namePlaceholder")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <PersonSelect
          label={t("cards.field.holder")}
          value={holder}
          onChange={setHolder}
          people={directory.people}
        />
        <p class="field-hint">
          {t("cards.field.reference")} <code>{tagPseudonym}</code>
        </p>
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" type="submit" disabled={action.value !== null}>
            {t("common.save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function RemoveCardDialog({
  name,
  tagPseudonym,
  onClose,
}: {
  name: string;
  tagPseudonym: string;
  onClose: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <Dialog title={t("cards.removeTitle", { name })} onClose={onClose}>
      <p>{t("cards.removeBody")}</p>
      <label class="check-field">
        <input
          type="checkbox"
          checked={understood}
          onChange={(event) => setUnderstood(event.currentTarget.checked)}
        />
        <span>{t("cards.removeAcknowledge")}</span>
      </label>
      <footer class="dialog-actions">
        <button class="button ghost" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          class="button danger"
          type="button"
          disabled={!understood || action.value !== null}
          onClick={() => {
            // The checkbox is the owner's acknowledgement, in their language, of exactly what the
            // server's fixed confirmation phrase states.
            void runOwnerTagRevoke(tagPseudonym, {
              confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
            }).then(onClose);
          }}
        >
          {t("cards.removeConfirm")}
        </button>
      </footer>
    </Dialog>
  );
}

/** Chargers whose desired list holds the same physical card (resolved on the server). */
function stationLabel(id: string): string {
  return fleetSignal.value?.stations.find((station) => station.id === id)?.label ?? id;
}

/** `true` when a charger has exactly one card, which removal therefore keeps. */
function isOnlyCard(id: string): boolean {
  const cards = fleetCards.value?.cards ?? [];
  return (
    cards.filter(({ members }) => members.some((member) => member.stationId === id)).length === 1
  );
}

function cardMembers(stationId: string, tagPseudonym: string) {
  const card = fleetCards.value?.cards.find(({ members }) =>
    members.some(
      (member) => member.stationId === stationId && member.tagPseudonym === tagPseudonym,
    ),
  );
  return card?.members ?? [];
}

function presentOn(stationId: string, tagPseudonym: string): readonly string[] {
  const members = cardMembers(stationId, tagPseudonym);
  return members.length ? members.map((member) => member.stationId) : [stationId];
}
