import { useState } from "preact/hooks";

import type { FleetCard, FleetSnapshot } from "../../shared/contracts.js";
import type { DirectoryPerson, OwnerDirectory } from "../../shared/directory.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../../shared/owner-tags.js";
import { revokeOwnerTag, saveStationProfile } from "../api.js";
import {
  fetchStationDelegations,
  removeFleetCard,
  revokeStationDelegation,
  setStationOwnership,
} from "../fleet-client.js";
import {
  fleetCards,
  issuedAccess,
  refreshFleetExtras,
  runIssueDriverAccess,
} from "../fleet-model.js";
import { formatDate, t, tn, type MessageKey } from "../i18n/index.js";
import {
  action,
  directory as directorySignal,
  handleError,
  ownerToken,
  refreshFleet,
} from "../model.js";
import { Dialog } from "../ui.js";
import { RetireChargerDialog } from "./fleet-setup.js";

/** The employee page link: their own charger, their sessions and their personal cards. */
export function EmployeeAccessDialog({
  person,
  stations,
  onClose,
}: {
  person: DirectoryPerson;
  stations: readonly { id: string; label: string }[];
  onClose: () => void;
}) {
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const issued = issuedAccess.value;
  const link =
    issued && issued.stationId
      ? `${window.location.origin}/me#station=${encodeURIComponent(issued.stationId)}&token=${encodeURIComponent(issued.created.token)}`
      : null;
  return (
    <Dialog
      title={t("fleet.access.title", { name: person.name })}
      onClose={() => {
        issuedAccess.value = null;
        onClose();
      }}
    >
      {!link ? (
        <form
          class="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runIssueDriverAccess(stationId);
          }}
        >
          <p class="dialog-lede">{t("fleet.access.lede")}</p>
          <ul class="scope-list">
            <li>{t("fleet.access.can.status")}</li>
            <li>{t("fleet.access.can.sessions")}</li>
            <li>{t("fleet.access.can.personal")}</li>
            <li class="cannot">{t("fleet.access.cannot.company")}</li>
          </ul>
          {stations.length > 1 && (
            <label>
              {t("fleet.access.station")}
              <select
                value={stationId}
                onChange={(event) => setStationId(event.currentTarget.value)}
              >
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p class="field-hint">{t("fleet.access.expiry")}</p>
          <footer class="dialog-actions">
            <button class="button ghost" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              class="button primary"
              type="submit"
              disabled={!stationId || action.value !== null}
            >
              {t("fleet.access.create")}
            </button>
          </footer>
        </form>
      ) : (
        <div class="dialog-form">
          <p class="dialog-lede">{t("fleet.access.send", { name: person.name })}</p>
          <code class="secret-link">{link}</code>
          <p class="inline-alert warn">
            {t("fleet.access.once", { date: formatDate(issued!.created.grant.expiresAt) })}
          </p>
          <footer class="dialog-actions">
            <button
              class="button secondary"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(link)}
            >
              {t("fleet.sheet.copy")}
            </button>
            <button
              class="button primary"
              type="button"
              onClick={() => {
                issuedAccess.value = null;
                onClose();
              }}
            >
              {t("fleet.sheet.done")}
            </button>
          </footer>
        </div>
      )}
    </Dialog>
  );
}

type Path = "company-keeps" | "employee-takes";

interface PlanLine {
  readonly key: string;
  readonly text: string;
  readonly run: (token: string) => Promise<string>;
}

/**
 * When an employee leaves: one reviewed plan, run step by step, each result shown. It only uses
 * existing owner actions (remove card, revoke access, reassign, classify). Nothing is sent to a
 * charger until the owner sends the updated lists.
 */
export function OffboardDialog({
  person,
  directory,
  fleet,
  onClose,
}: {
  person: DirectoryPerson;
  directory: OwnerDirectory;
  fleet: FleetSnapshot;
  onClose: () => void;
}) {
  const [path, setPath] = useState<Path | null>(null);
  const [removePersonal, setRemovePersonal] = useState(true);
  const [results, setResults] = useState<
    readonly { key: string; text: string; outcome: string }[] | null
  >(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const label = (id: string) => fleet.stations.find((station) => station.id === id)?.label ?? id;
  const ownStations = directory.stations.filter(
    ({ driverPersonId }) => driverPersonId === person.id,
  );
  const ownIds = new Set(ownStations.map(({ id }) => id));
  const cards = personCards(directory, person.id, ownIds, fleetCards.value?.cards ?? []);
  const cardName = (card: FleetCard) => {
    const member = card.members[0]!;
    return (
      directory.cards.find(
        (entry) =>
          entry.stationId === member.stationId && entry.tagPseudonym === member.tagPseudonym,
      )?.name ?? t("cards.unnamedShort", { id: member.tagPseudonym.slice(4, 10) })
    );
  };

  const plan: PlanLine[] = [];
  if (path) {
    for (const { card, held } of cards) {
      const personal = card.policy?.ownership === "personal";
      const reference = card.members[0]!;
      const remove = !personal || (path === "company-keeps" && removePersonal);
      if (remove && !held) {
        // Found only because it is on their charger: it may be shared, so it leaves their
        // chargers only and keeps working everywhere else.
        const local = card.members.filter(({ stationId }) => ownIds.has(stationId));
        plan.push({
          key: `local-${reference.stationId}-${reference.tagPseudonym}`,
          run: async (token) => {
            for (const member of local) {
              await revokeOwnerTag(
                member.stationId,
                member.tagPseudonym,
                { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
                token,
              );
            }
            return t("fleet.offboard.done");
          },
          text: t("fleet.offboard.removeCard", {
            name: cardName(card),
            stations: local.map(({ stationId }) => label(stationId)).join(", "),
          }),
        });
      } else if (remove) {
        plan.push({
          key: `remove-${reference.stationId}-${reference.tagPseudonym}`,
          run: async (token) => {
            const result = await removeFleetCard(reference, token);
            const kept = result.stations.filter(({ outcome }) => outcome === "kept-last-card");
            return kept.length
              ? t("fleet.offboard.keptLast", {
                  stations: kept.map(({ stationId }) => label(stationId)).join(", "),
                })
              : t("fleet.offboard.done");
          },
          text: t("fleet.offboard.removeCard", {
            name: cardName(card),
            stations: card.members.map(({ stationId }) => label(stationId)).join(", "),
          }),
        });
      } else if (path === "employee-takes") {
        const elsewhere = card.members.filter(({ stationId }) => !ownIds.has(stationId));
        if (elsewhere.length) {
          plan.push({
            key: `trim-${reference.stationId}-${reference.tagPseudonym}`,
            run: async (token) => {
              for (const member of elsewhere) {
                await revokeOwnerTag(
                  member.stationId,
                  member.tagPseudonym,
                  { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
                  token,
                );
              }
              return t("fleet.offboard.done");
            },
            text: t("fleet.offboard.trimCard", {
              name: cardName(card),
              stations: elsewhere.map(({ stationId }) => label(stationId)).join(", "),
            }),
          });
        }
      }
    }
    for (const station of ownStations) {
      plan.push({
        key: `access-${station.id}`,
        run: async (token) => {
          const grants = await fetchStationDelegations(station.id, token);
          const active = grants.filter(
            ({ role, status }) => role === "driver" && status === "active",
          );
          for (const grant of active)
            await revokeStationDelegation(station.id, grant.grantId, token);
          return tn("fleet.offboard.revoked", active.length);
        },
        text: t("fleet.offboard.revokeAccess", { station: station.label }),
      });
      if (path === "company-keeps") {
        plan.push({
          key: `unassign-${station.id}`,
          run: async (token) => {
            directorySignal.value = await saveStationProfile(
              station.id,
              { driverPersonId: null, label: station.label, site: station.site },
              token,
            );
            return t("fleet.offboard.done");
          },
          text: t("fleet.offboard.unassign", { station: station.label }),
        });
      } else if (fleet.stations.find(({ id }) => id === station.id)?.ownership !== "employee") {
        plan.push({
          key: `ownership-${station.id}`,
          run: async (token) => {
            await setStationOwnership(station.id, "employee", token);
            return t("fleet.offboard.done");
          },
          text: t("fleet.offboard.markEmployee", { station: station.label }),
        });
      }
    }
  }

  const execute = async () => {
    const token = ownerToken.value;
    if (!token) return;
    action.value = "directory";
    const done: { key: string; text: string; outcome: string }[] = [];
    try {
      for (const line of plan) {
        try {
          done.push({ key: line.key, outcome: await line.run(token), text: line.text });
        } catch (error) {
          done.push({
            key: line.key,
            outcome: error instanceof Error ? error.message : t("notice.failed"),
            text: line.text,
          });
        }
        setResults([...done]);
      }
    } catch (error) {
      handleError(error);
    } finally {
      action.value = null;
      await refreshFleet(false);
      await refreshFleetExtras();
    }
  };

  return (
    <Dialog title={t("fleet.offboard.title", { name: person.name })} onClose={onClose}>
      {!results ? (
        <div class="dialog-form">
          <fieldset class="choice-group">
            <legend>{t("fleet.offboard.question")}</legend>
            {(["company-keeps", "employee-takes"] as const).map((value) => (
              <label key={value} class={`choice${path === value ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="offboard-path"
                  checked={path === value}
                  onChange={() => setPath(value)}
                />
                <span>
                  <strong>
                    {t(`fleet.offboard.${value}` as MessageKey, { name: person.name })}
                  </strong>
                  <small>
                    {t(`fleet.offboard.${value}Hint` as MessageKey, { name: person.name })}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {path === "company-keeps" &&
            cards.some(({ card }) => card.policy?.ownership === "personal") && (
              <label class="check-field">
                <input
                  type="checkbox"
                  checked={removePersonal}
                  onChange={(event) => setRemovePersonal(event.currentTarget.checked)}
                />
                <span>{t("fleet.offboard.removePersonal")}</span>
              </label>
            )}
          {path && (
            <section class="plan-box">
              <h3>{t("fleet.offboard.plan")}</h3>
              {plan.length ? (
                <ol>
                  {plan.map((line) => (
                    <li key={line.key}>{line.text}</li>
                  ))}
                </ol>
              ) : (
                <p class="muted">{t("fleet.offboard.nothing")}</p>
              )}
              <p class="fine-print">{t("fleet.offboard.money")}</p>
            </section>
          )}
          <footer class="dialog-actions">
            <button class="button ghost" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              class="button danger"
              type="button"
              disabled={!path || plan.length === 0 || action.value !== null}
              onClick={() => void execute()}
            >
              {t("fleet.offboard.run")}
            </button>
          </footer>
        </div>
      ) : (
        <div class="dialog-form">
          <ol class="result-list">
            {results.map((line) => (
              <li key={line.key}>
                <span>{line.text}</span>
                <small>{line.outcome}</small>
              </li>
            ))}
          </ol>
          <p class="inline-alert warn">{t("fleet.offboard.syncNext")}</p>
          {path === "employee-takes" && ownStations.length > 0 && (
            <p class="fine-print">{t("fleet.offboard.retireLater")}</p>
          )}
          <footer class="dialog-actions">
            {path === "employee-takes" &&
              ownStations.map((station) => (
                <button
                  key={station.id}
                  class="button ghost"
                  type="button"
                  onClick={() => setRetiring(station.id)}
                >
                  {t("fleet.offboard.retireStation", { station: station.label })}
                </button>
              ))}
            <a class="button primary" href="#/stations" onClick={onClose}>
              {t("nav.stations")}
            </a>
          </footer>
        </div>
      )}
      {retiring && (
        <RetireChargerDialog
          stationId={retiring}
          label={label(retiring)}
          onClose={() => setRetiring(null)}
        />
      )}
    </Dialog>
  );
}

/** The fleet cards this person carries, by the directory's holder names. */
/**
 * Cards the plan covers: cards named as this person's in the directory, plus every personal or
 * unclassified card on their own chargers. Cards an employee added from their own page have no
 * holder name, so the directory alone would leave them working after the employee leaves.
 */
function personCards(
  directory: OwnerDirectory,
  personId: string,
  ownStationIds: ReadonlySet<string>,
  cards: readonly FleetCard[],
): readonly { readonly card: FleetCard; readonly held: boolean }[] {
  const held = new Set(
    directory.cards
      .filter(({ holderPersonId }) => holderPersonId === personId)
      .map(({ stationId, tagPseudonym }) => `${stationId}\n${tagPseudonym}`),
  );
  return cards.flatMap((card): { card: FleetCard; held: boolean }[] => {
    if (
      card.members.some(({ stationId, tagPseudonym }) => held.has(`${stationId}\n${tagPseudonym}`))
    )
      return [{ card, held: true }];
    return card.policy?.ownership !== "company" &&
      card.members.some(({ stationId }) => ownStationIds.has(stationId))
      ? [{ card, held: false }]
      : [];
  });
}
