import { useEffect, useRef, useState } from "preact/hooks";

import type { FleetSnapshot, SyncReadyResult, SyncReadyReview } from "../../shared/contracts.js";
import { fetchSyncReview } from "../fleet-client.js";
import { runSyncReady } from "../fleet-model.js";
import { t, tn } from "../i18n/index.js";
import { action, ownerToken } from "../model.js";
import { Dialog } from "../ui.js";

export function FleetSyncDialog({ fleet, onClose }: { fleet: FleetSnapshot; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [review, setReview] = useState<SyncReadyReview | null>(null);
  const [result, setResult] = useState<SyncReadyResult | null>(null);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void fetchSyncReview(ownerToken.value).then(
      (next) => {
        if (!active) return;
        if (typeof next?.reviewId === "string" && Array.isArray(next.stations)) setReview(next);
        else setError(true);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setReview(null);
    setResult(null);
    setError(false);
    setAttempt(attempt + 1);
  }

  async function send() {
    if (!review || inFlight.current || action.value !== null) return;
    inFlight.current = true;
    setSending(true);
    const outcome = await runSyncReady(review.reviewId);
    inFlight.current = false;
    setSending(false);
    if (outcome) setResult(outcome);
    else setError(true);
  }

  const eligible = review?.stations.filter(({ state }) => state === "eligible").length ?? 0;
  const stationName = (stationId: string) =>
    fleet.stations.find(({ id }) => id === stationId)?.label ?? stationId;
  const rows =
    result?.stations.map((row) => ({ ...row, state: row.outcome, additions: 0, removals: 0 })) ??
    review?.stations.map((row) => ({ ...row, listVersion: null }));

  return (
    <Dialog
      title={t(result ? "fleet.sync.result" : "fleet.sync.review")}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <p>{t(result ? "fleet.sync.resultBody" : "fleet.sync.reviewBody")}</p>
      {error && (
        <p role="alert" class="inline-alert warn">
          {t("fleet.sync.retryBody")}
        </p>
      )}
      {!rows && !error && <p role="status">{t("fleet.sync.loading")}</p>}
      {rows && (
        <ul class="fleet-sync-rows">
          {rows.map(({ stationId, state, additions, removals, listVersion }) => (
            <li key={stationId}>
              <strong>{stationName(stationId)}</strong>
              <span>
                {t(`fleet.sync.state.${state}`)}
                {listVersion !== null &&
                  ` · ${t("fleet.sync.revision", { revision: listVersion })}`}
              </span>
              {state === "eligible" && (
                <small>{t("fleet.sync.changes", { additions, removals })}</small>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer class="dialog-actions">
        <button class="button ghost" type="button" disabled={sending} onClick={onClose}>
          {t(result ? "common.close" : "common.cancel")}
        </button>
        {error ? (
          <button class="button primary" type="button" onClick={retry}>
            {t("fleet.sync.reviewAgain")}
          </button>
        ) : (
          !result && (
            <button
              class="button primary"
              type="button"
              disabled={!eligible || sending || action.value !== null}
              onClick={() => void send()}
            >
              {sending ? t("cards.sync.sending") : tn("fleet.sync.send", eligible)}
            </button>
          )
        )}
      </footer>
    </Dialog>
  );
}
