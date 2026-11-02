import { useState } from "preact/hooks";

import type { FleetSnapshot } from "../../shared/contracts.js";
import {
  DIRECTORY_NAME_MAX_LENGTH,
  type DirectoryPerson,
  type OwnerDirectory,
} from "../../shared/directory.js";
import { t, tn } from "../i18n/index.js";
import { action, runAddPerson, runRemovePerson, runRenamePerson } from "../model.js";
import { Dialog, initials, PageHead, shortPseudonym } from "../ui.js";

export function PeoplePage({
  directory,
  fleet,
  company,
}: {
  directory: OwnerDirectory | null;
  fleet: FleetSnapshot;
  company: boolean;
}) {
  const [editing, setEditing] = useState<DirectoryPerson | "new" | null>(null);
  const [removing, setRemoving] = useState<DirectoryPerson | null>(null);
  const title = t(company ? "people.titleCompany" : "people.title");

  if (!directory) {
    return (
      <div class="section-stack">
        <PageHead title={title} />
        <p class="inline-alert warn">{t("directory.unavailable")}</p>
      </div>
    );
  }

  const stationName = (stationId: string) =>
    fleet.stations.find(({ id }) => id === stationId)?.label ?? stationId;

  return (
    <div class="section-stack">
      <PageHead
        title={title}
        lede={t(company ? "people.ledeCompany" : "people.lede")}
        actions={
          directory.writable && (
            <button class="button primary" type="button" onClick={() => setEditing("new")}>
              {t(company ? "people.addCompany" : "people.add")}
            </button>
          )
        }
      />
      {!directory.writable && <p class="inline-alert warn">{t("directory.readOnly")}</p>}

      {directory.people.length === 0 ? (
        <section class="panel glass empty-panel">
          <p>{t(company ? "people.emptyCompany" : "people.empty")}</p>
        </section>
      ) : (
        <ul class="entity-grid" aria-label={title}>
          {directory.people.map((person) => {
            const stations = directory.stations.filter(
              ({ driverPersonId }) => driverPersonId === person.id,
            );
            const cards = directory.cards.filter(
              ({ holderPersonId }) => holderPersonId === person.id,
            );
            return (
              <li class="entity-card glass person-card" key={person.id}>
                <header class="entity-head">
                  <span class="entity-avatar" aria-hidden="true">
                    {initials(person.name)}
                  </span>
                  <div class="entity-title">
                    <h2>{person.name}</h2>
                    <span>
                      {tn("people.stationCount", stations.length)} ·{" "}
                      {tn("cards.count", cards.length)}
                    </span>
                  </div>
                </header>
                <dl class="entity-facts">
                  <div>
                    <dt>{t("people.stations")}</dt>
                    <dd>
                      {stations.length ? (
                        stations.map(({ label }) => label).join(", ")
                      ) : (
                        <span class="muted">{t("people.noStation")}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("nav.cards")}</dt>
                    <dd>
                      {cards.length ? (
                        <ul class="plain-list">
                          {cards.map((card) => (
                            <li key={`${card.stationId}-${card.tagPseudonym}`}>
                              {card.name ??
                                t("cards.unnamedShort", { id: shortPseudonym(card.tagPseudonym) })}
                              <small class="muted"> · {stationName(card.stationId)}</small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span class="muted">{t("people.noCards")}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {directory.writable && (
                  <footer class="entity-actions">
                    <button
                      class="button secondary compact"
                      type="button"
                      onClick={() => setEditing(person)}
                    >
                      {t("people.rename")}
                    </button>
                    <button
                      class="button danger-ghost compact"
                      type="button"
                      onClick={() => setRemoving(person)}
                    >
                      {t("common.remove")}
                    </button>
                  </footer>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p class="fine-print">{t("people.privacy")}</p>

      {editing && (
        <PersonDialog
          person={editing === "new" ? null : editing}
          company={company}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <Dialog
          title={t("people.removeTitle", { name: removing.name })}
          onClose={() => setRemoving(null)}
        >
          <p>{t("people.removeBody")}</p>
          <footer class="dialog-actions">
            <button class="button ghost" type="button" onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </button>
            <button
              class="button danger"
              type="button"
              disabled={action.value !== null}
              onClick={() =>
                void runRemovePerson(removing.id).then((done) => done && setRemoving(null))
              }
            >
              {t("common.remove")}
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}

function PersonDialog({
  person,
  company,
  onClose,
}: {
  person: DirectoryPerson | null;
  company: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(person?.name ?? "");
  return (
    <Dialog
      title={person ? t("people.renameTitle") : t(company ? "people.addCompany" : "people.add")}
      onClose={onClose}
    >
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const done = person
            ? runRenamePerson(person.id, name)
            : runAddPerson(name).then((created) => created !== null);
          void done.then((saved) => saved && onClose());
        }}
      >
        <label>
          {t("people.field.name")}
          <input
            value={name}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            autocomplete="off"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            class="button primary"
            type="submit"
            disabled={name.trim().length === 0 || action.value !== null}
          >
            {t("common.save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
