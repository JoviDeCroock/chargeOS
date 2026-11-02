import { useState } from "preact/hooks";

import type { OwnerSnapshot } from "../../shared/contracts.js";
import { DIRECTORY_NAME_MAX_LENGTH, type OwnerDirectory } from "../../shared/directory.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../../shared/owner-tags.js";
import { t, tn } from "../i18n/index.js";
import {
  action,
  runAuthorizationSync,
  runOwnerTagAdd,
  runOwnerTagRevoke,
  runSaveCard,
} from "../model.js";
import type { Route } from "../routes.js";
import { cardLabel, Dialog, PageHead, PersonSelect, shortPseudonym } from "../ui.js";

type Editing =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly tagPseudonym: string }
  | { readonly kind: "remove"; readonly tagPseudonym: string };

export function CardsPage({
  snapshot: current,
  directory,
  go,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  go: (next: Route) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const authorization = current.authorization;
  const stationId = current.station.id;
  const canName = Boolean(directory?.writable);

  return (
    <div class="section-stack">
      <PageHead
        title={t("cards.title")}
        lede={t("cards.lede", { station: current.station.label })}
        actions={
          <button class="button primary" type="button" onClick={() => setEditing({ kind: "add" })}>
            {t("cards.add")}
          </button>
        }
      />

      <SyncBanner snapshot={current} go={go} />

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
            return (
              <li key={tag} class="card-row">
                <span class="rfid-chip" aria-hidden="true" />
                <div class="card-main">
                  <strong>{card.name}</strong>
                  <small>
                    {card.holder ?? <span class="muted">{t("people.nobody")}</span>}
                    {card.named && <code class="card-ref">{shortPseudonym(tag)}</code>}
                  </small>
                </div>
                <span class={`state-chip ${onCharger ? "ok" : "warn"}`}>
                  {t(onCharger ? "cards.onCharger" : "cards.waiting")}
                </span>
                <div class="card-actions">
                  {canName && (
                    <button
                      class="button secondary compact"
                      type="button"
                      onClick={() => setEditing({ kind: "edit", tagPseudonym: tag })}
                    >
                      {t("common.edit")}
                    </button>
                  )}
                  <button
                    class="button danger-ghost compact"
                    type="button"
                    disabled={authorization.tagCount <= 1 || action.value !== null}
                    title={authorization.tagCount <= 1 ? t("cards.keepOne") : undefined}
                    onClick={() => setEditing({ kind: "remove", tagPseudonym: tag })}
                  >
                    {t("common.remove")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {authorization.tagCount <= 1 && <p class="fine-print">{t("cards.keepOne")}</p>}
      </section>

      <p class="fine-print">{t("cards.privacy")}</p>

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
            ? t("cards.sync.neverLong")
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
          class="button secondary"
          type="button"
          onClick={() => go({ page: "advanced", tab: "offline" })}
        >
          {t("cards.sync.openOffline")}
        </button>
      )}
    </div>
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
  const [name, setName] = useState("");
  const [holder, setHolder] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState("");
  const canName = Boolean(directory?.writable);
  const valid =
    cardNumber.length > 0 && cardNumber.length <= 20 && cardNumber.trim() === cardNumber;
  return (
    <Dialog title={t("cards.addTitle", { station: stationLabel })} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const newHolderName = holder === "new" ? newPerson.trim() : "";
            const added = await runOwnerTagAdd(
              { tag: cardNumber },
              canName
                ? {
                    holderPersonId: holder === "new" ? null : holder,
                    name: name.trim() || null,
                    ...(newHolderName ? { newHolderName } : {}),
                  }
                : undefined,
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
        {canName && directory && (
          <>
            <label>
              {t("cards.field.name")}
              <input
                value={name}
                maxLength={DIRECTORY_NAME_MAX_LENGTH}
                placeholder={t("cards.field.namePlaceholder")}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label>
              {t("cards.field.holder")}
              <select
                value={holder ?? ""}
                onChange={(event) => setHolder(event.currentTarget.value || null)}
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
            {holder === "new" && (
              <label>
                {t("people.field.name")}
                <input
                  value={newPerson}
                  maxLength={DIRECTORY_NAME_MAX_LENGTH}
                  onInput={(event) => setNewPerson(event.currentTarget.value)}
                />
              </label>
            )}
          </>
        )}
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
