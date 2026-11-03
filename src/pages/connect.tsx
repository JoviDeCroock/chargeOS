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
      aliasCandidate: null,
      endpointBase: null,
      lastRefused: null,
      lastUnmatchedAt: null,
      refusedSinceStart: 0,
      unmatchedSinceStart: 0,
    }
  );
}

/** The overview shows connection help until the charger is online and identified. */
export function needsConnectionHelp(current: OwnerSnapshot): boolean {
  const diagnostics = diagnosticsOf(current);
  return !current.station.connected || !current.station.boot || diagnostics.lastRefused !== null;
}

/**
 * Walks the owner through connecting the charger and explains, in plain words, why chargeOS
 * refused the last attempt. It refreshes itself while it waits, so the owner can watch it turn
 * green while the installer types the settings in.
 */
export function ConnectChargerPanel({
  snapshot: current,
  overview = false,
}: {
  snapshot: OwnerSnapshot;
  overview?: boolean;
}) {
  const station = current.station;
  const diagnostics = diagnosticsOf(current);
  const refused = diagnostics.lastRefused;
  const waiting = !station.connected || !station.boot;

  useEffect(() => {
    if (overview || (!waiting && !refused)) return undefined;
    const timer = setInterval(() => void pollSnapshot(), POLL_MS);
    return () => clearInterval(timer);
  }, [overview, waiting, refused !== null, station.id]);

  const address = diagnostics.endpointBase ? `${diagnostics.endpointBase}${station.id}` : null;

  const installerSettings = (
    <>
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
        <Fact
          label={t("connect.password")}
          value={t(station.managed ? "fleet.connect.passwordSheet" : "connect.passwordWhere")}
        />
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
  );
  return (
    <section
      class={`panel glass connect-panel${overview ? " overview-connect" : ""}`}
      aria-labelledby="connect-title"
    >
      <header class="panel-head">
        <h2 id="connect-title">{t("connect.title")}</h2>
        {(!overview || station.connected) && (
          <span
            class={`state-chip ${station.connected && station.boot ? "ok" : refused ? "warn" : "idle"}`}
            role="status"
          >
            {t(
              station.connected
                ? station.boot
                  ? "connect.state.connected"
                  : "connect.state.awaitingBoot"
                : "connect.state.waiting",
            )}
          </span>
        )}
      </header>

      {refused && <RefusalExplanation attempt={refused} expected={station.id} />}
      {diagnostics.aliasCandidate && (
        <AliasOffer presented={diagnostics.aliasCandidate.presentedIdentity} />
      )}

      {!station.connected && overview && (
        <>
          <p class="overview-connect-copy">
            {t(station.boot ? "overview.reconnect" : "overview.connectFirst")}
          </p>
          <a class="button primary" href="/help?guide=connect-a-charger">
            {t("overview.connectionGuide")}
          </a>
          <details class="overview-disclosure">
            <summary>{t("overview.installerSettings")}</summary>
            <p>{t("connect.intro")}</p>
            {installerSettings}
            <p class="fine-print">{t("connect.installerNote")}</p>
          </details>
        </>
      )}
      {!station.connected && !overview && (
        <>
          <p>{t("connect.intro")}</p>
          {installerSettings}
        </>
      )}
      {station.connected && !station.boot && <p>{t("connect.awaitingBootBody")}</p>}
      {(!overview || station.connected) && <p class="fine-print">{t("connect.installerNote")}</p>}
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
      {UNPROVEN_SOURCE.has(attempt.reason) && (
        <p class="fine-print">{t("connect.refused.anyDevice")}</p>
      )}
    </div>
  );
}

/**
 * Offered only for a name the charger presented with its own password; the server keeps that
 * separately, so later wrong-password attempts by anyone else cannot make the offer disappear.
 */
function AliasOffer({ presented }: { presented: string }) {
  return (
    <div class="alias-offer">
      <p>{t("connect.alias.offer", { presented })}</p>
      <button
        class="button secondary compact"
        type="button"
        disabled={action.value !== null}
        onClick={() => void runAcceptIdentityAlias(presented)}
      >
        {action.value === "identity-alias"
          ? t("connect.alias.accepting")
          : t("connect.alias.accept", { presented })}
      </button>
    </div>
  );
}
