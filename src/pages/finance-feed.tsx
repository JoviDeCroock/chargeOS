import { fleetGrants, issuedAccess, runIssueFinanceFeed, runRevokeAccess } from "../fleet-model.js";
import { formatDate, t } from "../i18n/index.js";
import { action } from "../model.js";

const RENEW_WITHIN_DAYS = 14;

/**
 * The monthly feed the commercial service (or finance) reads: business sessions per charger by
 * card reference, never names or card numbers, never private cards. Access lasts 90 days and is
 * renewed here; renewing issues a new secret and ends the old one.
 */
export function FinanceFeedPanel() {
  const grants = fleetGrants.value;
  if (!grants) return null;
  const active =
    grants.find(({ role, status }) => role === "finance" && status === "active") ?? null;
  const daysLeft = active
    ? Math.ceil((Date.parse(active.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const issued = issuedAccess.value?.stationId === null ? issuedAccess.value : null;
  const renewSoon = daysLeft !== null && daysLeft <= RENEW_WITHIN_DAYS;
  return (
    <section class="panel glass finance-feed" aria-labelledby="finance-feed-title">
      <header class="panel-head">
        <div>
          <h2 id="finance-feed-title">{t("fleet.feed.title")}</h2>
          <p class="panel-sub">{t("fleet.feed.lede")}</p>
        </div>
        <span class={`state-chip ${active ? (renewSoon ? "warn" : "ok") : "idle"}`}>
          {active
            ? renewSoon
              ? t("fleet.feed.renewSoon", { days: daysLeft ?? 0 })
              : t("fleet.feed.activeUntil", { date: formatDate(active.expiresAt) })
            : t("fleet.feed.off")}
        </span>
      </header>
      <ul class="scope-list">
        <li>{t("fleet.feed.includes")}</li>
        <li class="cannot">{t("fleet.feed.excludes")}</li>
      </ul>
      {issued && (
        <div class="delegate-secret" role="status">
          <div>
            <strong>{t("sharing.copyNow")}</strong>
            <p>{t("fleet.feed.secretBody")}</p>
          </div>
          <code>{issued.created.token}</code>
          <code class="muted">
            GET /api/v1/delegate/reimbursement?month=YYYY-MM&amp;timeZone=Europe/Brussels
          </code>
          <button class="text-button" type="button" onClick={() => (issuedAccess.value = null)}>
            {t("sharing.dismiss")}
          </button>
        </div>
      )}
      <footer class="entity-actions">
        <button
          class={`button ${active && !renewSoon ? "secondary" : "primary"}`}
          type="button"
          disabled={action.value !== null}
          onClick={() => void runIssueFinanceFeed(active?.grantId ?? null)}
        >
          {active ? t("fleet.feed.renew") : t("fleet.feed.create")}
        </button>
        {active && (
          <button
            class="button danger-ghost"
            type="button"
            disabled={action.value !== null}
            onClick={() => {
              if (window.confirm(t("sharing.revokeConfirm")))
                void runRevokeAccess(null, active.grantId);
            }}
          >
            {t("sharing.revoke")}
          </button>
        )}
      </footer>
    </section>
  );
}
