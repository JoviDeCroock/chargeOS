import { BrandMark } from "../brand.js";
import { useComputed, useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import {
  energy,
  euro,
  navigation,
  previewCases,
  previewDrivers,
  previewRoute,
  previewSessions,
  previewStations,
  workspaceLabels,
  type PreviewCase,
  type PreviewScenario,
  type PreviewSession,
  type PreviewWorkspace,
} from "./data.js";
import "./style.css";

interface Detail {
  readonly title: string;
  readonly content: ComponentChildren;
}

export function ProductPreview() {
  const route = useSignal(previewRoute(window.location.hash));
  const scenario = useSignal<PreviewScenario>("normal");
  const filter = useSignal("");
  const sessionType = useSignal("All sessions");
  const detail = useSignal<Detail | null>(null);
  const toast = useSignal("");
  const paused = useSignal(false);
  const approved = useSignal(false);
  const cases = useSignal<readonly PreviewCase[]>(previewCases);
  const title = useSignal("");
  const category = useSignal("Charger connection");
  const selected = useComputed(() =>
    navigation[route.value.workspace].find((item) => item.id === route.value.page)!,
  );
  const sessions = useComputed(() =>
    previewSessions.filter(
      (session) =>
        (sessionType.value === "All sessions" || session.locationType === sessionType.value) &&
        `${session.id} ${session.location} ${session.day} ${session.status}`
          .toLowerCase()
          .includes(filter.value.toLowerCase()),
    ),
  );

  useEffect(() => {
    const onHashChange = () => {
      route.value = previewRoute(window.location.hash);
      filter.value = "";
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [route, filter]);
  useEffect(() => {
    if (!toast.value) return;
    const timer = window.setTimeout(() => {
      toast.value = "";
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [toast.value]);

  function navigate(workspace: PreviewWorkspace, page = "overview") {
    route.value = { workspace, page };
    filter.value = "";
    window.location.hash = `${workspace}/${page}`;
  }
  function explain(titleText: string, body: ComponentChildren) {
    detail.value = { title: titleText, content: body };
  }
  function showSession(session: PreviewSession) {
    explain(
      `Session ${session.id}`,
      <>
        <p class="pv-modal-intro">A sample session, with the records behind the number.</p>
        <dl class="pv-details">
          <div>
            <dt>Location</dt>
            <dd>{session.location}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>
              {new Intl.DateTimeFormat("en-BE", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Europe/Brussels",
              }).format(new Date(session.startedAt))}
            </dd>
          </div>
          <div>
            <dt>Energy</dt>
            <dd>{energy(session.energyWh)}</dd>
          </div>
          <div>
            <dt>Statement value</dt>
            <dd>{euro(session.amountCents)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Badge label={session.status} />
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>Fictional preview fixture</dd>
          </div>
        </dl>
        <p class="pv-fine">
          A production record will link the original meter observations, eligibility, policy version
          and statement. These sample values are not a reimbursement policy.
        </p>
      </>,
    );
  }

  const workspace = route.value.workspace;
  const page = route.value.page;
  const isOverview = page === "overview";
  const homeWh = previewSessions
    .filter((s) => s.locationType === "Home")
    .reduce((sum, s) => sum + s.energyWh, 0);
  const homeCents = previewSessions
    .filter((s) => s.locationType === "Home")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const heldCents = previewSessions
    .filter((s) => s.status === "Needs review")
    .reduce((sum, s) => sum + s.amountCents, 0);

  return (
    <div class="product-shell">
      <div class="pv-preview-bar">
        <span>
          <span class="pv-preview-dot" /> Product preview · fictional data
        </span>
        <span>Local only. No charger commands or payments. Changes reset on reload.</span>
        <a href="/">Open owner console ↗</a>
      </div>
      <div class="pv-layout">
        <aside class="pv-sidebar">
          <a href="#driver/overview" class="pv-brand" aria-label="chargeOS driver overview">
            <BrandMark />
            <sup>Preview</sup>
          </a>
          <label class="pv-workspace-label">
            Preview workspace
            <select
              aria-label="Preview workspace"
              value={workspace}
              onChange={(event) => navigate(event.currentTarget.value as PreviewWorkspace)}
            >
              {Object.entries(workspaceLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p class="pv-nav-label">
            {workspace === "driver"
              ? "Your charging"
              : workspace === "employer"
                ? "Northstar Studio · sample"
                : "Service operations"}
          </p>
          <nav class="pv-nav" aria-label={`${workspaceLabels[workspace]} navigation`}>
            {navigation[workspace].map((item) => (
              <a
                key={item.id}
                href={`#${workspace}/${item.id}`}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => navigate(workspace, item.id)}
              >
                <span aria-hidden="true">{item.mark}</span>
                {item.label}
                {item.id === "help" && <small>{cases.value.length}</small>}
              </a>
            ))}
          </nav>
          <div class="pv-sidebar-bottom">
            <a class="pv-observation-link" href="/observe">
              Analyze a local export <span>↗</span>
            </a>
            <div class="pv-ownership">
              <span aria-hidden="true">◇</span>
              <div>
                <strong>Your charger. Your choice.</strong>
                <p>Owner control is built in.</p>
              </div>
            </div>
            <div class="pv-profile">
              <span class="pv-avatar">
                {workspace === "driver" ? "AM" : workspace === "employer" ? "NS" : "OP"}
              </span>
              <div>
                <strong>
                  {workspace === "driver"
                    ? "Alex Morgan"
                    : workspace === "employer"
                      ? "Northstar Studio"
                      : "Operations team"}
                </strong>
                <small>Fictional preview account</small>
              </div>
            </div>
          </div>
        </aside>
        <div class="pv-workspace">
          <header class="pv-topbar">
            <div class="pv-breadcrumb">
              {workspaceLabels[workspace]} <span>/</span> <strong>{selected.value.label}</strong>
            </div>
            <div class="pv-top-actions">
              <span class="pv-calendar">October 2026</span>
              <button
                class="pv-icon-button"
                type="button"
                aria-label="View sample notifications"
                onClick={() =>
                  explain(
                    "Your updates",
                    <>
                      <Notice
                        title="One session needs review"
                        text="Sample case DEMO-041 is assigned to Jamie. Your other approved sessions can continue through the payment process."
                      />
                      <Notice
                        title="Statement ready to inspect"
                        text="The September sample statement is marked settled. In production, that state requires reliable settlement evidence."
                      />
                    </>,
                  )
                }
              >
                ♧<i />
              </button>
              <span class="pv-avatar small">AM</span>
            </div>
          </header>
          <main class="pv-main" id="preview-content">
            <div class="pv-page-heading">
              <div>
                <p class="pv-eyebrow">
                  {isOverview ? "Wednesday, 28 October" : workspaceLabels[workspace]}
                </p>
                <h1>
                  {isOverview
                    ? workspace === "driver"
                      ? "A good day starts charged."
                      : workspace === "employer"
                        ? "Your fleet, moving forward."
                        : "Keep every driver moving."
                    : selected.value.label}
                </h1>
                <p>
                  {isOverview
                    ? workspace === "driver"
                      ? "A clear view of your charging. And everything that follows."
                      : workspace === "employer"
                        ? "Charging, people and payments. One connected view."
                        : "The issues that need attention, with a clear next step."
                    : "Explore the proposed workflow with clearly identified sample records."}
                </p>
              </div>
              <label class="pv-scenario-label">
                Preview state
                <select
                  aria-label="Preview state"
                  value={scenario.value}
                  onChange={(event) => {
                    scenario.value = event.currentTarget.value as PreviewScenario;
                  }}
                >
                  <option value="normal">Normal</option>
                  <option value="offline">Offline</option>
                  <option value="empty">No data</option>
                  <option value="loading">Loading</option>
                  <option value="error">Service error</option>
                </select>
              </label>
            </div>
            {scenario.value === "offline" && (
              <div class="pv-offline" role="status">
                <b>Offline preview</b>
                <span>
                  Showing sample cached records. Controls are unavailable; charger-local operation
                  still requires real device proof.
                </span>
              </div>
            )}
            {scenario.value === "loading" ? (
              <div class="pv-loading" role="status" aria-busy="true">
                <div />
                <div />
                <div />
                <p>Loading preview records…</p>
                <button
                  type="button"
                  class="pv-button secondary"
                  onClick={() => {
                    scenario.value = "normal";
                  }}
                >
                  Finish loading preview
                </button>
              </div>
            ) : scenario.value === "error" ? (
              <EmptyState
                title="We couldn’t load this view."
                description="Your records haven’t been changed. This is a simulated service error."
                action="Try again"
                onAction={() => {
                  scenario.value = "normal";
                }}
              />
            ) : scenario.value === "empty" ? (
              <EmptyState
                title="Your next chapter starts here."
                description="There are no records in this preview state. In the product, we’ll guide you through connecting your first charger or importing your history."
                action="Explore sample data"
                onAction={() => {
                  scenario.value = "normal";
                }}
              />
            ) : (
              <>
                {workspace === "driver" && isOverview && (
                  <>
                    <div class="pv-driver-grid">
                      <section class="pv-charger-card">
                        <div class="pv-card-top">
                          <span class="pv-overline">Your home charger</span>
                          <Badge
                            label={
                              scenario.value === "offline"
                                ? "Offline"
                                : paused.value
                                  ? "Paused"
                                  : "Charging"
                            }
                          />
                        </div>
                        <h2>Home. Ready when you are.</h2>
                        <p>Driveway · Sample Alfen charger</p>
                        <div class="pv-car-scene" aria-hidden="true">
                          <span class="pv-charge-post">
                            <i />
                          </span>
                          <span class="pv-charge-cable" />
                          <span class="pv-car">
                            <i class="pv-car-window" />
                            <i class="pv-car-wheel front" />
                            <i class="pv-car-wheel back" />
                            <i class="pv-car-light" />
                          </span>
                          <span class="pv-scene-line" />
                        </div>
                        <div class="pv-charge-stats">
                          <div>
                            <strong>
                              7.4 <small>kW</small>
                            </strong>
                            <span>Sample charging power</span>
                          </div>
                          <div>
                            <strong>21:30</strong>
                            <span>Sample ready-by time</span>
                          </div>
                          <div>
                            <strong>
                              18.6 <small>kWh</small>
                            </strong>
                            <span>This sample session</span>
                          </div>
                        </div>
                        <div class="pv-charger-footer">
                          <span>
                            <i class="pv-live-dot" />
                            {paused.value ? "Sample session paused" : "Sample session in progress"}
                          </span>
                          <button
                            type="button"
                            class="pv-button dark"
                            disabled={scenario.value === "offline"}
                            onClick={() => {
                              paused.value = !paused.value;
                              toast.value = `Preview ${paused.value ? "paused" : "resumed"}. No command was sent to a charger.`;
                            }}
                          >
                            {paused.value ? "Resume preview" : "Pause preview"}
                            <span aria-hidden="true">{paused.value ? "▷" : "Ⅱ"}</span>
                          </button>
                        </div>
                      </section>
                      <section class="pv-money-card">
                        <div class="pv-card-top">
                          <span class="pv-overline">Home reimbursement</span>
                          <span class="pv-month-pill">October</span>
                        </div>
                        <p class="pv-money-subtitle">Your home charging, accounted for.</p>
                        <div class="pv-money-amount">
                          {euro(homeCents - heldCents)}
                          <span>approved in this sample</span>
                        </div>
                        <div class="pv-money-breakdown">
                          <div>
                            <span>Recorded home energy</span>
                            <strong>{energy(homeWh)}</strong>
                          </div>
                          <div>
                            <span>Held for review</span>
                            <strong>{euro(heldCents)}</strong>
                          </div>
                        </div>
                        <div class="pv-mini-timeline">
                          <span class="done" />
                          <i />
                          <span class="done" />
                          <i />
                          <span />
                          <i />
                          <span />
                        </div>
                        <div class="pv-timeline-labels">
                          <span>Recorded</span>
                          <span>Approved</span>
                          <span>Submitted</span>
                          <span>Settled</span>
                        </div>
                        <p class="pv-money-note">
                          One sample session needs review. Approved amounts stay separate from money
                          actually paid.
                        </p>
                        <button
                          class="pv-text-button"
                          type="button"
                          onClick={() => navigate("driver", "money")}
                        >
                          Follow your reimbursement <span>↗</span>
                        </button>
                      </section>
                    </div>
                    <div class="pv-stats">
                      <Metric
                        label="Home energy this month"
                        value={energy(homeWh)}
                        note="From the sample activity below"
                      />
                      <Metric
                        label="Your home sessions"
                        value="4"
                        note="3 approved · 1 needs review"
                      />
                      <Metric
                        label="Other charging"
                        value="40.3 kWh"
                        note="Work and public sample sessions"
                      />
                    </div>
                    <div class="pv-lower-grid">
                      <section class="pv-panel">
                        <SectionTitle
                          eyebrow="Your charging pattern"
                          title="A little energy. A lot of possibility."
                          aside="Sample week"
                        />
                        <EnergyChart />
                        <div class="pv-chart-legend">
                          <span>
                            <i />
                            Home
                          </span>
                          <span>
                            <i />
                            Work
                          </span>
                          <span>
                            <i />
                            Public
                          </span>
                        </div>
                      </section>
                      <section class="pv-panel pv-next-card">
                        <span class="pv-overline">A small thing to check</span>
                        <span class="pv-task-symbol" aria-hidden="true">
                          ↗
                        </span>
                        <h2>
                          One session.
                          <br />A clearer answer.
                        </h2>
                        <p>
                          The meter reading on 22 October needs review. Jamie is following up on
                          your sample case.
                        </p>
                        <button
                          type="button"
                          class="pv-button secondary"
                          onClick={() => navigate("driver", "help")}
                        >
                          View the case <span>↗</span>
                        </button>
                      </section>
                    </div>
                    <SessionSection
                      sessions={previewSessions.slice(0, 4)}
                      onSelect={showSession}
                      onAll={() => navigate("driver", "activity")}
                    />
                  </>
                )}

                {workspace !== "driver" && isOverview && (
                  <>
                    <div class="pv-stats">
                      <Metric
                        label={workspace === "employer" ? "Sample drivers" : "Sample chargers"}
                        value="4"
                        note={
                          workspace === "employer"
                            ? "All assigned to a charging policy"
                            : "2 charging · 1 available · 1 offline"
                        }
                      />
                      <Metric
                        label={
                          workspace === "employer" ? "Draft home reimbursements" : "Open issues"
                        }
                        value={workspace === "employer" ? "€232.16" : String(cases.value.length)}
                        note={
                          workspace === "employer"
                            ? "Includes €9.57 requiring review"
                            : "Each has an accountable owner"
                        }
                      />
                      <Metric
                        label={
                          workspace === "employer" ? "Needs your attention" : "Financial exceptions"
                        }
                        value="1"
                        note="A disputed reading, ready to inspect"
                      />
                    </div>
                    <div class="pv-lower-grid">
                      <section class="pv-panel">
                        <SectionTitle
                          eyebrow="Priority inbox"
                          title={
                            workspace === "employer"
                              ? "A clear path to month-end."
                              : "Resolve what matters."
                          }
                        />
                        <button
                          class="pv-action-row"
                          type="button"
                          onClick={() => navigate(workspace, "money")}
                        >
                          <span class="pv-row-icon amber">€</span>
                          <div>
                            <strong>Review a sample reimbursement exception</strong>
                            <p>Alex Morgan · 22 Oct · €9.57 held</p>
                          </div>
                          <span>↗</span>
                        </button>
                        <button
                          class="pv-action-row"
                          type="button"
                          onClick={() =>
                            navigate(workspace, workspace === "employer" ? "sites" : "incidents")
                          }
                        >
                          <span class="pv-row-icon">ϟ</span>
                          <div>
                            <strong>Office bay 02 is offline in this sample</strong>
                            <p>Riley · Operations is investigating</p>
                          </div>
                          <span>↗</span>
                        </button>
                        <div class="pv-panel-footnote">
                          Preview records only. The workspace selector demonstrates UX; it does not
                          implement account permissions.
                        </div>
                      </section>
                      <section class="pv-panel">
                        <SectionTitle
                          eyebrow="Energy at a glance"
                          title="Across your sample locations"
                          aside="This week"
                        />
                        <EnergyChart />
                        <div class="pv-chart-legend">
                          <span>
                            <i />
                            Home
                          </span>
                          <span>
                            <i />
                            Work
                          </span>
                          <span>
                            <i />
                            Public
                          </span>
                        </div>
                      </section>
                    </div>
                    {workspace === "employer" ? (
                      <DriverTable
                        onSelect={(name) =>
                          explain(
                            name,
                            <p>
                              This sample employee has a home charger, company card and
                              effective-dated policy. Joining/leaving, permissions and financial
                              eligibility still require implementation.
                            </p>,
                          )
                        }
                      />
                    ) : (
                      <StationTable
                        onSelect={(name) =>
                          explain(
                            name,
                            <p>
                              This is a fictional station record. A production detail view will show
                              authenticated device identity, connector state, command outcomes,
                              diagnostics and recovery evidence.
                            </p>,
                          )
                        }
                      />
                    )}
                  </>
                )}

                {page === "activity" && (
                  <section class="pv-panel">
                    <div class="pv-filter-row">
                      <a class="pv-button primary" href="/observe">
                        Analyze a local CSV ↗
                      </a>
                      <label>
                        <span class="pv-sr-only">Search sample sessions</span>
                        <input
                          placeholder="Search location, date or status…"
                          value={filter.value}
                          onInput={(event) => {
                            filter.value = event.currentTarget.value;
                          }}
                        />
                      </label>
                      <label>
                        <span class="pv-sr-only">Session location type</span>
                        <select
                          aria-label="Session location type"
                          value={sessionType.value}
                          onChange={(event) => {
                            sessionType.value = event.currentTarget.value;
                          }}
                        >
                          {["All sessions", "Home", "Work", "Public"].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        class="pv-button secondary"
                        type="button"
                        onClick={() => {
                          downloadSampleCsv(sessions.value);
                          toast.value =
                            "Exported fictional sample sessions. No live records were accessed.";
                        }}
                      >
                        Export sample CSV ↓
                      </button>
                    </div>
                    <SessionTable sessions={sessions.value} onSelect={showSession} />
                  </section>
                )}

                {page === "money" && (
                  <>
                    <div class="pv-stats">
                      <Metric
                        label="Draft home statement"
                        value={workspace === "driver" ? euro(homeCents) : "€232.16"}
                        note="Illustrative policy values"
                      />
                      <Metric
                        label="Held for review"
                        value={euro(heldCents)}
                        note="Never counted as paid"
                      />
                      <Metric
                        label="Sample statement status"
                        value={approved.value ? "Approved" : "In review"}
                        note="No payment has been executed"
                      />
                    </div>
                    <section class="pv-panel">
                      <SectionTitle
                        eyebrow="October · sample statement"
                        title="See exactly where things stand."
                        aside={<Badge label={approved.value ? "Approved" : "Needs review"} />}
                      />
                      <div class="pv-payment-path">
                        {[
                          "Recorded",
                          "Policy checked",
                          "Approved",
                          "Funded",
                          "Submitted",
                          "Settled",
                        ].map((step, index) => (
                          <div
                            key={step}
                            class={index < (approved.value ? 3 : 2) ? "complete" : ""}
                          >
                            <span>{index + 1}</span>
                            <strong>{step}</strong>
                            <small>
                              {index === 0
                                ? "Sample sessions"
                                : index === 1
                                  ? "One exception held"
                                  : index === 2
                                    ? approved.value
                                      ? "Preview approval"
                                      : "Awaiting approval"
                                    : "No real integration"}
                            </small>
                          </div>
                        ))}
                      </div>
                      <div class="pv-exception">
                        <div>
                          <Badge label="Needs review" />
                          <h3>22 October · meter reading</h3>
                          <p>
                            {euro(heldCents)} held separately. Jamie · Finance support owns this
                            sample case. Next action: compare the original meter record.
                          </p>
                        </div>
                        <button
                          type="button"
                          class="pv-button secondary"
                          onClick={() =>
                            explain(
                              "Meter reading under review",
                              <>
                                <p>Sample case DEMO-041 · {euro(heldCents)} held.</p>
                                <p>
                                  Jamie · Finance support will compare the original meter record
                                  before releasing this session. Approving the other sessions does
                                  not release this amount.
                                </p>
                              </>,
                            )
                          }
                        >
                          Review details
                        </button>
                      </div>
                      {workspace !== "driver" && (
                        <button
                          type="button"
                          class="pv-button primary"
                          disabled={approved.value || scenario.value === "offline"}
                          onClick={() => {
                            approved.value = true;
                            toast.value =
                              "Sample eligible amount approved in this preview only. The disputed session remains held; no payment was sent.";
                          }}
                        >
                          {" "}
                          {approved.value
                            ? "Preview eligible amount approved"
                            : "Simulate approval of eligible amount"}
                        </button>
                      )}
                      <p class="pv-fine">
                        This is a proposed financial workflow with fictional records. Real policy
                        calculation, approval authority, funding and settlement are separate
                        implementation milestones.
                      </p>
                    </section>
                    <SessionSection
                      sessions={previewSessions.filter((s) => s.locationType === "Home")}
                      onSelect={showSession}
                    />
                  </>
                )}

                {page === "charger" && (
                  <>
                    <div class="pv-stats">
                      <Metric
                        label="Your sample charger"
                        value="Alfen"
                        note="Exact-device proof still required"
                      />
                      <Metric
                        label="Connection"
                        value={scenario.value === "offline" ? "Offline" : "Sample online"}
                        note="No connection to your actual charger"
                      />
                      <Metric
                        label="Ownership"
                        value="You"
                        note="Product principle; not an account claim"
                      />
                    </div>
                    <section class="pv-panel">
                      <SectionTitle
                        eyebrow="Charger preferences"
                        title="Your daily routine, on your terms."
                      />
                      <div class="pv-settings-row">
                        <div>
                          <strong>Charging mode</strong>
                          <p>Preview a schedule or an immediate charge.</p>
                        </div>
                        <select
                          aria-label="Sample charging mode"
                          onChange={() => {
                            toast.value =
                              "Preview preference changed. Nothing was saved to a charger.";
                          }}
                        >
                          <option>Scheduled charging</option>
                          <option>Charge now</option>
                          <option>Solar preference · proposed</option>
                        </select>
                      </div>
                      <div class="pv-settings-row">
                        <div>
                          <strong>Ready by</strong>
                          <p>Sample ready-by preference, not a device schedule.</p>
                        </div>
                        <input aria-label="Sample ready by time" type="time" defaultValue="07:30" />
                      </div>
                      <div class="pv-settings-row">
                        <div>
                          <strong>Charging access</strong>
                          <p>Essential owner access must survive cloud loss.</p>
                        </div>
                        <button
                          class="pv-button secondary"
                          type="button"
                          onClick={() => navigate("driver", "cards")}
                        >
                          View sample cards
                        </button>
                      </div>
                      <div class="pv-settings-row">
                        <div>
                          <strong>Recovery & ownership</strong>
                          <p>
                            Inspect the existing authenticated console for actual recovery evidence.
                          </p>
                        </div>
                        <a class="pv-button secondary" href="/">
                          Open owner console ↗
                        </a>
                      </div>
                      <p class="pv-fine">
                        No endpoint, charging profile, RFID list, power limit, firmware or network
                        setting is changed by this preview.
                      </p>
                    </section>
                  </>
                )}

                {page === "cards" && (
                  <div class="pv-cards-grid">
                    <section class="pv-card-visual">
                      <span class="pv-brand">chargeOS</span>
                      <span class="pv-contactless" aria-hidden="true">
                        )))
                      </span>
                      <strong>Everyday energy.</strong>
                      <p>Alex Morgan · fictional card</p>
                      <span>DEMO · 0028</span>
                    </section>
                    <section class="pv-panel">
                      <SectionTitle eyebrow="Access & cards" title="One card, a clear owner." />
                      <dl class="pv-details">
                        <div>
                          <dt>Home access</dt>
                          <dd>
                            <Badge label="Preview active" />
                          </dd>
                        </div>
                        <div>
                          <dt>Employer</dt>
                          <dd>Northstar Studio · sample</dd>
                        </div>
                        <div>
                          <dt>Public roaming</dt>
                          <dd>Partner integration required</dd>
                        </div>
                        <div>
                          <dt>Lost card</dt>
                          <dd>Online blocking and offline revocation need separate handling.</dd>
                        </div>
                      </dl>
                      <button
                        class="pv-button secondary"
                        type="button"
                        onClick={() =>
                          explain(
                            "Report a lost card",
                            <p>
                              The product will block online authorization immediately and show
                              pending offline revocation until the charger acknowledges it. This
                              preview cannot issue, block or replace a real card.
                            </p>,
                          )
                        }
                      >
                        Preview lost-card flow
                      </button>
                    </section>
                  </div>
                )}

                {page === "road" && (
                  <>
                    <div class="pv-note">
                      <b>Public charging concept</b>
                      <span>
                        Locations below are fictional. Live availability, tariffs, roaming
                        agreements and payments are not connected.
                      </span>
                    </div>
                    <div class="pv-road-layout">
                      <div
                        class="pv-map"
                        aria-label="Illustrative map of fictional charging locations"
                      >
                        <span class="pv-map-road one" />
                        <span class="pv-map-road two" />
                        <span class="pv-map-road three" />
                        <span class="pv-map-park" />
                        <span class="pv-map-water" />
                        <b class="pv-map-label">Leuven · illustration</b>
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            class={`pv-map-pin pin-${n}`}
                            type="button"
                            aria-label={`Inspect fictional charging location ${n}`}
                            onClick={() =>
                              explain(
                                `Sample charging location ${n}`,
                                <p>
                                  A production location will show licensed network data, connector
                                  compatibility, tariff components, availability freshness and a
                                  supported start method. No live network or reservation is
                                  represented here.
                                </p>,
                              )
                            }
                          >
                            ϟ
                          </button>
                        ))}
                      </div>
                      <section class="pv-panel">
                        <SectionTitle
                          eyebrow="Illustrative locations"
                          title="A good stop along the way."
                        />
                        {[
                          "City garage · Example",
                          "Riverside · Example",
                          "Station square · Example",
                        ].map((name, index) => (
                          <button
                            class="pv-location"
                            key={name}
                            type="button"
                            onClick={() =>
                              explain(
                                name,
                                <p>
                                  Fictional location. Real pricing, access and availability require
                                  an independent roaming integration.
                                </p>,
                              )
                            }
                          >
                            <span class="pv-row-icon">ϟ</span>
                            <div>
                              <strong>{name}</strong>
                              <p>
                                {index === 1 ? "DC connector concept" : "AC connector concept"} ·
                                Sample only
                              </p>
                              <small>Price & availability not connected</small>
                            </div>
                            <span>↗</span>
                          </button>
                        ))}
                      </section>
                    </div>
                  </>
                )}

                {(page === "help" || page === "incidents") && (
                  <div class="pv-support-grid">
                    <section class="pv-panel">
                      <SectionTitle eyebrow="Accountable support" title="A person. A next step." />
                      {cases.value.map((item) => (
                        <button
                          class="pv-case-row"
                          type="button"
                          key={item.id}
                          onClick={() =>
                            explain(
                              item.title,
                              <>
                                <Badge label={item.status} />
                                <p>
                                  {item.id} · {item.category}
                                </p>
                                <dl class="pv-details">
                                  <div>
                                    <dt>Owner</dt>
                                    <dd>{item.owner}</dd>
                                  </div>
                                  <div>
                                    <dt>Latest update</dt>
                                    <dd>{item.update}</dd>
                                  </div>
                                  <div>
                                    <dt>Next action</dt>
                                    <dd>
                                      Inspect the original evidence and update the affected
                                      customer.
                                    </dd>
                                  </div>
                                </dl>
                                <p class="pv-fine">
                                  Sample case only. No support team has been contacted.
                                </p>
                              </>,
                            )
                          }
                        >
                          <div>
                            <small>
                              {item.id} · {item.category}
                            </small>
                            <strong>{item.title}</strong>
                            <p>{item.owner}</p>
                          </div>
                          <Badge label={item.status} />
                        </button>
                      ))}
                    </section>
                    <section class="pv-panel">
                      <SectionTitle eyebrow="Local preview only" title="Try opening a case." />
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const value = title.value.trim();
                          if (!value) return;
                          const id = `DEMO-${String(cases.value.length + 41).padStart(3, "0")}`;
                          cases.value = [
                            ...cases.value,
                            {
                              id,
                              title: value,
                              category: category.value,
                              owner: "Unassigned · preview",
                              status: "Open",
                              update: "Created in this browser preview",
                            },
                          ];
                          title.value = "";
                          toast.value = `${id} created in memory. No message was sent; it will reset on reload.`;
                        }}
                      >
                        <label class="pv-field">
                          What do you need help with?
                          <select
                            value={category.value}
                            onChange={(event) => {
                              category.value = event.currentTarget.value;
                            }}
                          >
                            <option>Charger connection</option>
                            <option>Reimbursement</option>
                            <option>Charging card</option>
                            <option>Other</option>
                          </select>
                        </label>
                        <label class="pv-field">
                          Short description
                          <input
                            required
                            maxLength={160}
                            placeholder="Use fictional information for this preview"
                            value={title.value}
                            onInput={(event) => {
                              title.value = event.currentTarget.value;
                            }}
                          />
                        </label>
                        <button
                          class="pv-button primary"
                          type="submit"
                          disabled={scenario.value === "offline"}
                        >
                          Create preview case ↗
                        </button>
                      </form>
                      <p class="pv-fine">
                        For a real fault, use your existing provider’s support. This form is a local
                        interaction prototype.
                      </p>
                    </section>
                  </div>
                )}

                {page === "drivers" && (
                  <DriverTable
                    onSelect={(name) =>
                      explain(
                        name,
                        <>
                          <p>
                            Fictional employee record. The commercial model needs effective
                            employment dates, vehicle/card assignment, home charger ownership,
                            policy eligibility and cost center.
                          </p>
                          <Notice
                            title="Offboarding preserves ownership"
                            text="Ending an employer’s access must not remove the household’s ownership or essential local charging."
                          />
                        </>,
                      )
                    }
                  />
                )}
                {(page === "sites" || page === "chargers") && (
                  <StationTable
                    onSelect={(name) =>
                      explain(
                        name,
                        <>
                          <p>
                            Sample station detail. The implemented owner console is separate and
                            uses authenticated, station-scoped evidence.
                          </p>
                          <a class="pv-button secondary" href="/">
                            Open owner console ↗
                          </a>
                        </>,
                      )
                    }
                  />
                )}
                {page === "policies" && (
                  <section class="pv-panel">
                    <SectionTitle
                      eyebrow="Policy versions"
                      title="The rule behind every reimbursement."
                    />
                    <div class="pv-policy-card">
                      <Badge label="Illustrative policy" />
                      <h3>Home charging · October example</h3>
                      <dl class="pv-details">
                        <div>
                          <dt>Eligibility</dt>
                          <dd>Company charging at the assigned home charger</dd>
                        </div>
                        <div>
                          <dt>Example rate</dt>
                          <dd>€0.3222 / kWh · fictional policy input</dd>
                        </div>
                        <div>
                          <dt>Effective period</dt>
                          <dd>1–31 October 2026 · sample</dd>
                        </div>
                        <div>
                          <dt>Conflicts</dt>
                          <dd>Hold disputed sessions for review</dd>
                        </div>
                        <div>
                          <dt>Changes</dt>
                          <dd>Create a new version; retain the original decision trail</dd>
                        </div>
                      </dl>
                      <p class="pv-fine">
                        This example rate is not a tax or reimbursement recommendation. The actual
                        policy must be approved by the employer and implemented by the financial
                        engine.
                      </p>
                    </div>
                  </section>
                )}
                {page === "billing" && (
                  <section class="pv-panel">
                    <SectionTitle
                      eyebrow="Documents & settlement"
                      title="Every total has a trail."
                    />
                    <div class="pv-document-row">
                      <div>
                        <strong>September sample statement</strong>
                        <p>DEMO-INV-2026-09 · fictional record</p>
                      </div>
                      <Badge label="Sample settled" />
                      <button
                        type="button"
                        class="pv-button secondary"
                        onClick={() =>
                          explain(
                            "Sample September statement",
                            <p>
                              This is a demonstration document. Real statements require approved
                              source sessions, immutable policy references, applicable accounting
                              treatment, corrections and settlement evidence. No real invoice is
                              available in this preview.
                            </p>,
                          )
                        }
                      >
                        Inspect sample ↗
                      </button>
                    </div>
                    <div class="pv-document-row">
                      <div>
                        <strong>October draft</strong>
                        <p>One session held for review</p>
                      </div>
                      <Badge label={approved.value ? "Approved" : "Needs review"} />
                      <button
                        type="button"
                        class="pv-button secondary"
                        onClick={() => navigate(workspace, "money")}
                      >
                        Review draft ↗
                      </button>
                    </div>
                  </section>
                )}
                {page === "reports" && (
                  <section class="pv-panel">
                    <SectionTitle
                      eyebrow="Costs & energy"
                      title="A consistent view, across the fleet."
                    />
                    <DriverTable
                      embedded
                      onSelect={(name) =>
                        explain(
                          name,
                          <p>
                            Sample driver report. In production, this amount must reconcile to
                            approved statement, cost-center and payment totals.
                          </p>,
                        )
                      }
                    />
                    <button
                      type="button"
                      class="pv-button secondary"
                      onClick={() => {
                        downloadSampleCsv(previewSessions);
                        toast.value =
                          "Exported sample activity only. Accounting and payroll integration are not connected.";
                      }}
                    >
                      Export sample activity ↓
                    </button>
                  </section>
                )}
                {page === "migrations" && (
                  <section class="pv-panel">
                    <SectionTitle eyebrow="Observe first" title="A switch with a way back." />
                    <div class="pv-migration-path">
                      {[
                        "Inventory & authority",
                        "Configuration backup",
                        "Historical export",
                        "Standalone rollback",
                        "Controlled switch",
                        "Freedom Test",
                        "Independent review",
                      ].map((item, index) => (
                        <div key={item}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{item}</strong>
                            <p>
                              {index < 3
                                ? "Can be prepared with authorized read-only evidence."
                                : "Requires explicit authorization and exact-device evidence."}
                            </p>
                          </div>
                          <Badge label={index < 3 ? "Preparation" : "Not performed"} />
                        </div>
                      ))}
                    </div>
                    <div class="pv-note">
                      <b>ThreeForce stays connected.</b>
                      <span>
                        This preview cannot change an endpoint, execute a migration or claim a
                        charger has passed its Freedom Test.
                      </span>
                    </div>
                    <a class="pv-button secondary" href="/">
                      Open authenticated migration console ↗
                    </a>
                  </section>
                )}
                {page === "connections" && (
                  <div class="pv-integrations">
                    {[
                      {
                        title: "Charger gateway",
                        type: "Existing owner-edge foundation",
                        copy: "OCPP 1.6J and local recovery exist in the authenticated console.",
                      },
                      {
                        title: "Payment execution",
                        type: "Independent partner required",
                        copy: "Funding, collection, payouts and bank confirmation are not connected.",
                      },
                      {
                        title: "Public roaming",
                        type: "Independent partner required",
                        copy: "Network agreements, card issuance and charge records are not connected.",
                      },
                      {
                        title: "Accounting & payroll",
                        type: "Customer integration required",
                        copy: "Versioned documents and verified export handoff need implementation.",
                      },
                      {
                        title: "Field service",
                        type: "Installer arrangements required",
                        copy: "Quotes, appointments, inspections and physical support need an accountable partner.",
                      },
                      {
                        title: "Cloud hosting",
                        type: "Architecture decision pending",
                        copy: "Cloudflare requires transport, storage and portable recovery adapters.",
                      },
                    ].map((item) => (
                      <section class="pv-panel" key={item.title}>
                        <span class="pv-overline">{item.type}</span>
                        <h2>{item.title}</h2>
                        <p>{item.copy}</p>
                        <Badge label="Not connected in preview" />
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
            <footer class="pv-footer">
              <span>chargeOS · Control starts with you.</span>
              <span>Fictional product preview · October 2026</span>
            </footer>
          </main>
        </div>
      </div>
      {toast.value && (
        <div class="pv-toast" role="status">
          <span>{toast.value}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => {
              toast.value = "";
            }}
          >
            ×
          </button>
        </div>
      )}
      {detail.value && (
        <PreviewDialog
          title={detail.value.title}
          onClose={() => {
            detail.value = null;
          }}
        >
          {detail.value.content}
        </PreviewDialog>
      )}
    </div>
  );
}

function Badge({ label }: { readonly label: string }) {
  const tone = /review|offline|investigating|not performed/i.test(label)
    ? "amber"
    : /approved|charging|active|settled|available/i.test(label)
      ? "green"
      : "neutral";
  return (
    <span class={`pv-badge ${tone}`}>
      <i />
      {label}
    </span>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <section class="pv-metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
function SectionTitle({
  eyebrow,
  title,
  aside,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly aside?: ComponentChildren;
}) {
  return (
    <div class="pv-section-title">
      <div>
        <p class="pv-overline">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {aside && <span>{aside}</span>}
    </div>
  );
}
function Notice({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div class="pv-notice">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
function EmptyState({
  title,
  description,
  action,
  onAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly onAction: () => void;
}) {
  return (
    <section class="pv-empty">
      <span aria-hidden="true">ϟ</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" class="pv-button primary" onClick={onAction}>
        {action} ↗
      </button>
    </section>
  );
}
function EnergyChart() {
  const days = [
    { day: "Thu", home: 40, work: 0, pub: 0 },
    { day: "Fri", home: 0, work: 31, pub: 0 },
    { day: "Sat", home: 0, work: 0, pub: 26 },
    { day: "Sun", home: 66, work: 0, pub: 0 },
    { day: "Mon", home: 0, work: 42, pub: 0 },
    { day: "Tue", home: 50, work: 0, pub: 0 },
    { day: "Wed", home: 33, work: 0, pub: 0 },
  ];
  return (
    <div
      class="pv-chart"
      role="img"
      aria-label="Illustrative weekly energy chart; fictional values, not the session table totals"
    >
      <div class="pv-chart-y">
        <span>50 kWh</span>
        <span>25 kWh</span>
        <span>0</span>
      </div>
      <div class="pv-chart-bars">
        {days.map((day) => (
          <div class="pv-bar-group" key={day.day}>
            <div class="pv-bar-track">
              <i style={{ height: `${day.home}%` }} />
              <i style={{ height: `${day.work}%` }} />
              <i style={{ height: `${day.pub}%` }} />
            </div>
            <span>{day.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function SessionSection({
  sessions,
  onSelect,
  onAll,
}: {
  readonly sessions: readonly PreviewSession[];
  readonly onSelect: (session: PreviewSession) => void;
  readonly onAll?: () => void;
}) {
  return (
    <section class="pv-panel">
      <SectionTitle
        eyebrow="Every session, accounted for"
        title="Recent activity"
        aside={
          onAll && (
            <button type="button" class="pv-text-button" onClick={onAll}>
              View all activity ↗
            </button>
          )
        }
      />
      <SessionTable sessions={sessions} onSelect={onSelect} />
    </section>
  );
}
function SessionTable({
  sessions,
  onSelect,
}: {
  readonly sessions: readonly PreviewSession[];
  readonly onSelect: (session: PreviewSession) => void;
}) {
  return (
    <>
      <div class="pv-table-wrap pv-session-desktop">
        <table class="pv-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Date & duration</th>
              <th>Energy</th>
              <th>Sample amount</th>
              <th>Status</th>
              <th>
                <span class="pv-sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <span
                    class={`pv-location-icon ${session.locationType.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {session.locationType === "Home"
                      ? "⌂"
                      : session.locationType === "Work"
                        ? "▥"
                        : "↗"}
                  </span>
                  <div>
                    <strong>{session.location}</strong>
                    <small>{session.locationType}</small>
                  </div>
                </td>
                <td>
                  {session.day}
                  <small>{session.duration}</small>
                </td>
                <td>{energy(session.energyWh)}</td>
                <td>{euro(session.amountCents)}</td>
                <td>
                  <Badge label={session.status} />
                </td>
                <td>
                  <button
                    type="button"
                    class="pv-icon-button"
                    aria-label={`View session ${session.id}`}
                    onClick={() => onSelect(session)}
                  >
                    ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 && (
          <p class="pv-table-empty">No sample sessions match these filters.</p>
        )}
      </div>
      <div class="pv-mobile-records">
        {sessions.map((session) => (
          <button
            type="button"
            class="pv-mobile-record"
            key={session.id}
            aria-label={`Inspect sample session ${session.id}`}
            onClick={() => onSelect(session)}
          >
            <div>
              <span
                class={`pv-location-icon ${session.locationType.toLowerCase()}`}
                aria-hidden="true"
              >
                {session.locationType === "Home" ? "⌂" : "↗"}
              </span>
              <span>
                <strong>{session.location}</strong>
                <small>
                  {session.day} · {session.duration}
                </small>
              </span>
              <b>{euro(session.amountCents)}</b>
            </div>
            <div>
              <span>{energy(session.energyWh)}</span>
              <Badge label={session.status} />
            </div>
          </button>
        ))}
        {sessions.length === 0 && (
          <p class="pv-table-empty">No sample sessions match these filters.</p>
        )}
      </div>
    </>
  );
}
function DriverTable({
  onSelect,
  embedded = false,
}: {
  readonly onSelect: (name: string) => void;
  readonly embedded?: boolean;
}) {
  const content = (
    <>
      <SectionTitle eyebrow="People & policies" title="Your sample drivers" />
      <div class="pv-table-wrap">
        <table class="pv-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Home charger</th>
              <th>Home energy</th>
              <th>Draft amount</th>
              <th>Status</th>
              <th>
                <span class="pv-sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {previewDrivers.map((driver) => (
              <tr key={driver.name}>
                <td>
                  <span class="pv-avatar">{driver.initials}</span>
                  <div>
                    <strong>{driver.name}</strong>
                    <small>{driver.team} · sample</small>
                  </div>
                </td>
                <td>{driver.station}</td>
                <td>{driver.energy}</td>
                <td>{driver.amount}</td>
                <td>
                  <Badge label={driver.state} />
                </td>
                <td>
                  <button
                    type="button"
                    class="pv-icon-button"
                    aria-label={`View ${driver.name}`}
                    onClick={() => onSelect(driver.name)}
                  >
                    ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  return embedded ? content : <section class="pv-panel">{content}</section>;
}
function StationTable({ onSelect }: { readonly onSelect: (name: string) => void }) {
  return (
    <section class="pv-panel">
      <SectionTitle eyebrow="Station operations" title="Your sample charging sites" />
      <div class="pv-table-wrap">
        <table class="pv-table">
          <thead>
            <tr>
              <th>Charger</th>
              <th>Site</th>
              <th>State</th>
              <th>Sample energy</th>
              <th>
                <span class="pv-sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {previewStations.map((station) => (
              <tr key={station.id}>
                <td>
                  <span class="pv-location-icon home" aria-hidden="true">
                    ϟ
                  </span>
                  <div>
                    <strong>{station.name}</strong>
                    <small>{station.id}</small>
                  </div>
                </td>
                <td>
                  {station.site}
                  <small>{station.device}</small>
                </td>
                <td>
                  <Badge label={station.state} />
                </td>
                <td>{station.energy}</td>
                <td>
                  <button
                    type="button"
                    class="pv-icon-button"
                    aria-label={`View ${station.name}`}
                    onClick={() => onSelect(station.name)}
                  >
                    ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function PreviewDialog({
  title,
  children,
  onClose,
}: {
  readonly title: string;
  readonly children: ComponentChildren;
  readonly onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement;
    const element = panel.current;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && element) {
        const targets = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input, select, [tabindex="0"]',
          ),
        ];
        const first = targets[0],
          last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, [onClose]);
  return (
    <div
      class="pv-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        class="pv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-dialog-title"
        ref={panel}
      >
        <div class="pv-dialog-heading">
          <span class="pv-overline">Fictional preview record</span>
          <button type="button" class="pv-icon-button" aria-label="Close details" onClick={onClose}>
            ×
          </button>
        </div>
        <h2 id="preview-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
function downloadSampleCsv(sessions: readonly PreviewSession[]) {
  const rows = [
    [
      "sample_id",
      "started_at",
      "location_type",
      "energy_wh",
      "illustrative_amount_cents",
      "status",
    ],
    ...sessions.map((s) => [
      s.id,
      s.startedAt,
      s.locationType,
      String(s.energyWh),
      String(s.amountCents),
      s.status,
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "chargeos-fictional-preview-sessions.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
