import { useState } from "preact/hooks";

import type { CardOwnership, CardUse } from "../../shared/cards.js";
import type { FleetSnapshot } from "../../shared/contracts.js";
import { runCopyCard, runRemoveEverywhere, runSetCardPolicy } from "../fleet-model.js";
import { t, tn, type MessageKey } from "../i18n/index.js";
import { action } from "../model.js";
import { Dialog } from "../ui.js";

export function CardPolicyFields({
  ownership,
  use,
  onOwnership,
  onUse,
}: {
  ownership: CardOwnership;
  use: CardUse;
  onOwnership: (value: CardOwnership) => void;
  onUse: (value: CardUse) => void;
}) {
  return (
    <>
      <fieldset class="segmented-field">
        <legend>{t("fleet.card.ownership")}</legend>
        <div class="segmented">
          {(["company", "personal"] as const).map((value) => (
            <label key={value} class={ownership === value ? "selected" : undefined}>
              <input
                type="radio"
                name="card-ownership"
                checked={ownership === value}
                onChange={() => {
                  onOwnership(value);
                  if (value === "personal") onUse("private");
                }}
              />
              {t(`fleet.card.ownership.${value}` as MessageKey)}
            </label>
          ))}
        </div>
        <small>{t(`fleet.card.ownership.${ownership}Hint` as MessageKey)}</small>
      </fieldset>
      <fieldset class="segmented-field">
        <legend>{t("fleet.card.use")}</legend>
        <div class="segmented">
          {(["business", "private"] as const).map((value) => (
            <label key={value} class={use === value ? "selected" : undefined}>
              <input
                type="radio"
                name="card-use"
                checked={use === value}
                onChange={() => onUse(value)}
              />
              {t(`fleet.card.use.${value}` as MessageKey)}
            </label>
          ))}
        </div>
        <small>{t(`fleet.card.use.${use}Hint` as MessageKey)}</small>
      </fieldset>
    </>
  );
}

export function ClassifyCardDialog({
  stationId,
  tagPseudonym,
  name,
  initial,
  onClose,
}: {
  stationId: string;
  tagPseudonym: string;
  name: string;
  initial: { ownership: CardOwnership; use: CardUse } | null;
  onClose: () => void;
}) {
  const [ownership, setOwnership] = useState<CardOwnership>(initial?.ownership ?? "company");
  const [use, setUse] = useState<CardUse>(initial?.use ?? "business");
  return (
    <Dialog title={t("fleet.classify.title", { name })} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSetCardPolicy({ stationId, tagPseudonym }, ownership, use).then(
            (done) => done && onClose(),
          );
        }}
      >
        <CardPolicyFields
          ownership={ownership}
          use={use}
          onOwnership={setOwnership}
          onUse={setUse}
        />
        <p class="field-hint">{t("fleet.classify.everywhere")}</p>
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

export function CopyCardDialog({
  stationId,
  tagPseudonym,
  name,
  fleet,
  presentOn,
  onClose,
}: {
  stationId: string;
  tagPseudonym: string;
  name: string;
  fleet: FleetSnapshot;
  presentOn: readonly string[];
  onClose: () => void;
}) {
  const candidates = fleet.stations.filter(({ id }) => !presentOn.includes(id));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <Dialog title={t("fleet.copy.title", { name })} onClose={onClose}>
      <p class="dialog-lede">{t("fleet.copy.lede")}</p>
      {candidates.length === 0 ? (
        <p class="muted">{t("fleet.copy.none")}</p>
      ) : (
        <ul class="station-pick-list">
          {candidates.map((station) => (
            <li key={station.id}>
              <label class="check-field">
                <input
                  type="checkbox"
                  checked={selected.has(station.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.currentTarget.checked) next.add(station.id);
                    else next.delete(station.id);
                    setSelected(next);
                  }}
                />
                <span>
                  {station.label}
                  <small class="muted"> · {station.site}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p class="field-hint">{t("fleet.copy.hint")}</p>
      <footer class="dialog-actions">
        <button class="button ghost" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          class="button primary"
          type="button"
          disabled={selected.size === 0 || action.value !== null}
          onClick={() =>
            void runCopyCard({ stationId, tagPseudonym }, [...selected]).then(
              (result) => result && onClose(),
            )
          }
        >
          {tn("fleet.copy.confirm", selected.size)}
        </button>
      </footer>
    </Dialog>
  );
}

export function LostCardDialog({
  stationId,
  tagPseudonym,
  name,
  stationLabels,
  keptLabels,
  onClose,
}: {
  stationId: string;
  tagPseudonym: string;
  name: string;
  /** Chargers the card will be removed from. */
  stationLabels: readonly string[];
  /** Chargers where it is the only card, which keep it so nobody is locked out. */
  keptLabels: readonly string[];
  onClose: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <Dialog title={t("fleet.lost.title", { name })} onClose={onClose}>
      {stationLabels.length > 0 && (
        <p>{t("fleet.lost.body", { stations: stationLabels.join(", ") })}</p>
      )}
      {keptLabels.length > 0 && (
        <p class="inline-alert risk">{t("fleet.lost.kept", { stations: keptLabels.join(", ") })}</p>
      )}
      <p class="inline-alert warn">{t("fleet.lost.delay")}</p>
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
          disabled={!understood || stationLabels.length === 0 || action.value !== null}
          onClick={() =>
            void runRemoveEverywhere({ stationId, tagPseudonym }).then(
              (result) => result && onClose(),
            )
          }
        >
          {t("fleet.lost.confirm")}
        </button>
      </footer>
    </Dialog>
  );
}
