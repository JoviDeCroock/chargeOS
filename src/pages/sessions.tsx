import type { OwnerSnapshot } from "../../shared/contracts.js";
import type { OwnerDirectory } from "../../shared/directory.js";
import { t } from "../i18n/index.js";
import { PageHead, SessionTable } from "../ui.js";

/** Every charging session on the selected charger: everyday owner data, not a technical tool. */
export function SessionsPage({
  snapshot: current,
  directory,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
}) {
  const station = current.station;
  return (
    <div class="section-stack">
      <PageHead
        title={t("sessions.title")}
        lede={
          station.label === station.id
            ? t("sessions.ledeThis")
            : t("sessions.lede", { station: station.label })
        }
      />
      <section class="panel glass" aria-label={t("sessions.title")}>
        <SessionTable sessions={current.sessions} directory={directory} stationId={station.id} />
      </section>
      <p class="fine-print">{t("sessions.note")}</p>
    </div>
  );
}
