import { useEffect } from "preact/hooks";

import type {
  OwnerSnapshot,
  RefusedConnectionAttempt,
  StationConnectionDiagnostics,
} from "../../shared/contracts.js";
import { formatTime, t, tn, type MessageKey } from "../i18n/index.js";
import { action, pollSnapshot, runAcceptIdentityAlias } from "../model.js";
import { Fact } from "../ui.js";

const POLL_MS = 5_000;

/** Older servers send no diagnostics; treat that as "nothing refused yet". */
function diagnosticsOf(current: OwnerSnapshot): StationConnectionDiagnostics {
  return (
    current.station.connection ?? {
      acceptedAlias: null,
      endpointBase: null,
      lastRefused: null,
      lastUnmatchedAt: null,
      refusedSinceStart: 0,
      unmatchedSinceStart: 0,
    }
  );
}

/** The overview shows the connection guide until the charger has connected and introduced itself. */
export function needsConnectionHelp(current: OwnerSnapshot): boolean {
  const diagnostics = diagnosticsOf(current);
  return !current.station.boot || diagnostics.lastRefused !== null;
}

/**
 * Walks the owner through connecting the charger and explains, in plain words, why chargeOS
 * refused the last attempt. It refreshes itself while it waits, so the owner can watch it turn
 * green while the installer types the settings in.
 */
export function ConnectChargerPanel({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  const station = current.station;
  const diagnostics = diagnosticsOf(current);
  const refused = diagnostics.lastRefused;
  const waiting = !station.connected || !station.boot;

  useEffect(() => {
    if (!waiting && !refused) return undefined;
    const timer = setInterval(() => void pollSnapshot(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refused !== null, station.id]);

  const address = diagnostics.endpointBase ? `${diagnostics.endpointBase}${station.id}` : null;

  return (
    <section class="panel glass connect-panel" aria-labelledby="connect-title">
      <header class="panel-head">
        <h2 id="connect-title">{t("connect.title")}</h2>
        <span
          class={`state-chip ${station.connected && station.boot ? "ok" : refused ? "warn" : "idle"}`}
          role="status"
        >
          {station.connected
            ? station.boot
              ? t("connect.state.connected")
              : t("connect.state.awaitingBoot")
            : t("connect.state.waiting")}
        </span>
      </header>

      {refused && <RefusalExplanation attempt={refused} expected={station.id} />}

      {!station.connected && (
        <>
          <p>{t("connect.intro")}</p>
          <dl class="facts connect-facts">
            <Fact
              label={t("connect.address")}
              value={address ?? t("connect.addressUnknown")}
              mono={address !== null}
            />
            <Fact
              label={t("connect.identity")}
              value={
                diagnostics.acceptedAlias
                  ? t("connect.identityWithAlias", {
                      alias: diagnostics.acceptedAlias,
                      id: station.id,
                    })
                  : station.id
              }
              mono
            />
            <Fact label={t("connect.password")} value={t("connect.passwordWhere")} />
            <Fact label={t("connect.protocol")} value={t("connect.protocolValue")} />
            <Fact label={t("connect.security")} value={t("connect.securityValue")} />
          </dl>
          <p class="fine-print">{t("connect.identityHint")}</p>
          {diagnostics.unmatchedSinceStart > 0 && (
            <p class="fine-print">
              {tn("connect.unmatched", diagnostics.unmatchedSinceStart, {
                time: diagnostics.lastUnmatchedAt ? formatTime(diagnostics.lastUnmatchedAt) : "—",
              })}
            </p>
          )}
        </>
      )}
      {station.connected && !station.boot && <p>{t("connect.awaitingBootBody")}</p>}
      <p class="fine-print">{t("connect.installerNote")}</p>
    </section>
  );
}

const REFUSAL_TEXT: Readonly<
  Record<RefusedConnectionAttempt["reason"], { title: MessageKey; fix: MessageKey }>
> = {
  "already-connected": { fix: "connect.refused.duplicateFix", title: "connect.refused.duplicate" },
  "identity-mismatch": { fix: "connect.refused.identityFix", title: "connect.refused.identity" },
  "password-missing": {
    fix: "connect.refused.noPasswordFix",
    title: "connect.refused.noPassword",
  },
  "password-wrong": {
    fix: "connect.refused.wrongPasswordFix",
    title: "connect.refused.wrongPassword",
  },
  "protocol-not-offered": {
    fix: "connect.refused.protocolFix",
    title: "connect.refused.protocol",
  },
};

/** Refusals that anyone who knows the charger name can cause; the others carried its password. */
const UNPROVEN_SOURCE: ReadonlySet<RefusedConnectionAttempt["reason"]> = new Set([
  "already-connected",
  "password-missing",
  "password-wrong",
]);

function RefusalExplanation({
  attempt,
  expected,
}: {
  attempt: RefusedConnectionAttempt;
  expected: string;
}) {
  const text = REFUSAL_TEXT[attempt.reason];
  return (
    <div class="inline-alert warn" role="alert">
      <strong>{t(text.title)}</strong>
      <p>
        {t("connect.refused.when", { time: formatTime(attempt.at) })}{" "}
        {attempt.reason === "identity-mismatch"
          ? attempt.presentedIdentity
            ? t("connect.refused.identityBody", { expected, presented: attempt.presentedIdentity })
            : t("connect.refused.identityUnprintable", { expected })
          : attempt.reason === "protocol-not-offered" && attempt.offeredProtocols.length
            ? t("connect.refused.protocolBody", { offered: attempt.offeredProtocols.join(", ") })
            : null}
      </p>
      <p>{t(text.fix, { expected })}</p>
      {attempt.reason === "identity-mismatch" && attempt.presentedIdentity && (
        <div class="alias-offer">
          <p>{t("connect.alias.offer", { presented: attempt.presentedIdentity })}</p>
          <button
            class="button secondary compact"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runAcceptIdentityAlias(attempt.presentedIdentity!)}
          >
            {action.value === "identity-alias"
              ? t("connect.alias.accepting")
              : t("connect.alias.accept", { presented: attempt.presentedIdentity })}
          </button>
        </div>
      )}
      {UNPROVEN_SOURCE.has(attempt.reason) && (
        <p class="fine-print">{t("connect.refused.anyDevice")}</p>
      )}
    </div>
  );
}
