import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type {
  ServiceOrganization,
  SupportCaseDetail,
  SupportWorkspaceData,
} from "../../shared/contracts.js";
import {
  SUPPORT_CLOSE_CONFIRMATION,
  type SupportAction,
  type SupportStatus,
} from "../../shared/support.js";
import { serviceRequest, ServiceRequestError } from "./client.js";
import "./support.css";

const statusText: Record<SupportStatus, string> = {
  open: "Open",
  "waiting-for-reporter": "Waiting for reporter",
  resolved: "Resolution ready to check",
  closed: "Closed · reporter confirmed",
};
const topics = {
  "statement-amount": "Statement amount",
  "missing-session": "Missing session",
  eligibility: "Employee eligibility",
  account: "Company account",
  other: "Another question",
};
const eventNames: Record<SupportAction, string> = {
  created: "Opened the case",
  reply: "Replied",
  assign: "Changed the assigned person",
  "request-information": "Asked for information",
  resolve: "Proposed a resolution",
  close: "Confirmed closure",
  reopen: "Reopened the case",
};
const time = (date: string) =>
  new Date(date).toLocaleString("en-BE", { dateStyle: "medium", timeStyle: "short" });
interface Props {
  organization: ServiceOrganization;
  actorId: string;
  initialStatementId: string | null;
  onOpenStatement: (id: string) => void;
  onSessionExpired: () => void;
}
export function SupportWorkspace({
  organization: org,
  actorId,
  initialStatementId,
  onOpenStatement,
  onSessionExpired,
}: Props) {
  const root = `/service/api/v1/organizations/${org.id}/support`;
  const data = useSignal<SupportWorkspaceData | null>(null),
    detail = useSignal<SupportCaseDetail | null>(null),
    busy = useSignal(true),
    error = useSignal(""),
    notice = useSignal("");
  const statementContext = useSignal(initialStatementId);
  const creating = useSignal(!!initialStatementId),
    subject = useSignal(initialStatementId ? "Question about my statement" : ""),
    topic = useSignal("statement-amount"),
    message = useSignal(""),
    action = useSignal("reply"),
    assignee = useSignal(""),
    resolution = useSignal("answer-provided"),
    confirmed = useSignal(false);
  const pending = useSignal<{ path: string; body: Record<string, unknown> } | null>(null);
  const staff = org.role !== "driver";
  function fail(problem: unknown) {
    if (problem instanceof ServiceRequestError && [401, 404].includes(problem.status)) {
      data.value = null;
      detail.value = null;
      message.value = "";
      pending.value = null;
    }
    if (problem instanceof ServiceRequestError && problem.status === 401) onSessionExpired();
    error.value =
      problem instanceof Error ? problem.message : "The case service is unavailable. Try again.";
  }
  async function read(work: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await work();
    } catch (problem) {
      fail(problem);
    } finally {
      busy.value = false;
    }
  }
  useEffect(() => {
    let active = true;
    void serviceRequest<SupportWorkspaceData>(root)
      .then((value) => {
        if (active) data.value = value;
      })
      .catch((problem) => {
        if (active) fail(problem);
      })
      .finally(() => {
        if (active) busy.value = false;
      });
    return () => {
      active = false;
      pending.value = null;
      message.value = "";
      detail.value = null;
    };
  }, [org.id]);
  async function open(id: string) {
    detail.value = await serviceRequest<SupportCaseDetail>(`${root}/${id}`);
    creating.value = false;
    message.value = "";
    confirmed.value = false;
    action.value =
      detail.value.case.status === "closed"
        ? detail.value.case.reporter.id === actorId
          ? "reopen"
          : ""
        : "reply";
    assignee.value = detail.value.case.assignee.id;
  }
  async function save(retry = false) {
    if (busy.value) return;
    if (!retry) {
      if (pending.value) return;
      let body: Record<string, unknown> = { mutationId: crypto.randomUUID() },
        path = root;
      if (creating.value)
        body = {
          ...body,
          subject: subject.value,
          topic: topic.value,
          statementId: statementContext.value,
          message: message.value,
        };
      else if (detail.value) {
        path += `/${detail.value.case.id}/${action.value}`;
        body.expectedRevision = detail.value.case.revision;
        if (action.value === "assign") body.assigneeId = assignee.value;
        else if (action.value === "close") {
          if (!confirmed.value) return;
          body.confirmation = SUPPORT_CLOSE_CONFIRMATION;
        } else {
          body.message = message.value;
          if (action.value === "resolve") body.resolution = resolution.value;
        }
      } else return;
      pending.value = { path, body };
    }
    if (!pending.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      const saved = await serviceRequest<SupportCaseDetail>(pending.value.path, pending.value.body);
      detail.value = saved;
      creating.value = false;
      pending.value = null;
      message.value = "";
      subject.value = "";
      confirmed.value = false;
      action.value = saved.case.status === "closed" ? "reopen" : "reply";
      assignee.value = saved.case.assignee.id;
      // Keep the acknowledged case visible even if the subsequent list refresh fails.
      notice.value = "Case update saved. No payment or charger setting was changed.";
      data.value = await serviceRequest<SupportWorkspaceData>(root);
    } catch (problem) {
      if (problem instanceof ServiceRequestError && problem.status < 500) pending.value = null;
      fail(problem);
    } finally {
      busy.value = false;
    }
  }
  const c = detail.value?.case,
    reporter = c?.reporter.id === actorId,
    responsible = staff && (org.role === "admin" || c?.assignee.id === actorId),
    locked = busy.value || !!pending.value;
  return (
    <section class="cs-card cs-support" aria-label="Support cases">
      <div class="cs-section-heading">
        <div>
          <h2>Support cases</h2>
          <p>Ask your company’s finance team about a statement or account issue.</p>
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            creating.value = true;
            statementContext.value = null;
            detail.value = null;
            message.value = "";
            subject.value = "";
          }}
        >
          Open a case
        </button>
      </div>
      <p class="cs-support-boundary">
        The reporter and current company finance/administration team can read every reply. Keep
        passwords, AI keys, RFID numbers, bank details and private files out of messages. Nothing is
        sent to AI or search. <a href="/help?guide=support">How support cases work</a>
      </p>
      {error.value && (
        <p class="cs-message cs-error" role="alert">
          {error.value}
        </p>
      )}
      {notice.value && (
        <p class="cs-message" role="status">
          {notice.value}
        </p>
      )}
      {pending.value && (
        <div class="cs-message">
          <p>
            The result is uncertain. Retry the same update before writing another one. Keep this tab
            open.
          </p>
          <button type="button" disabled={busy.value} onClick={() => void save(true)}>
            Retry same update
          </button>
        </div>
      )}
      {busy.value && !data.value && <p role="status">Loading your cases…</p>}
      {data.value && (
        <div class="cs-support-layout">
          <div class="cs-support-list">
            <h3>{staff ? "Company cases" : "Your cases"}</h3>
            {!data.value.cases.length ? (
              <p>No cases yet. Open one when you need help with a statement or account.</p>
            ) : (
              <ul>
                {data.value.cases.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={locked}
                      aria-pressed={c?.id === item.id}
                      onClick={() => void read(() => open(item.id))}
                    >
                      <strong>{item.subject}</strong>
                      <span>{statusText[item.status]}</span>
                      <small>
                        {item.reporter.name} · {time(item.updatedAt)}
                      </small>
                      <small>
                        {item.assignee.available
                          ? `Assigned to ${item.assignee.name}`
                          : "Needs staff reassignment"}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {data.value.nextBefore && (
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void read(async () => {
                    const cursor = data.value!.nextBefore!,
                      page = await serviceRequest<SupportWorkspaceData>(
                        `${root}?beforeTime=${cursor.createdAt}&beforeId=${encodeURIComponent(cursor.id)}`,
                      );
                    data.value = { ...page, cases: [...data.value!.cases, ...page.cases] };
                  })
                }
              >
                Load older cases
              </button>
            )}
          </div>
          <div class="cs-support-conversation">
            {creating.value ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <h3>Open a case</h3>
                {statementContext.value && (
                  <p>
                    This case will keep a reference to your selected statement’s original snapshot.
                  </p>
                )}
                <label>
                  Subject
                  <input
                    required
                    maxLength={120}
                    disabled={locked}
                    value={subject.value}
                    onInput={(event) => {
                      subject.value = event.currentTarget.value;
                    }}
                  />
                </label>
                <label>
                  Issue type
                  <select
                    disabled={locked}
                    value={topic.value}
                    onChange={(event) => {
                      topic.value = event.currentTarget.value;
                    }}
                  >
                    {Object.entries(topics).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  What needs checking?
                  <textarea
                    required
                    maxLength={2000}
                    rows={6}
                    disabled={locked}
                    value={message.value}
                    onInput={(event) => {
                      message.value = event.currentTarget.value;
                    }}
                  />
                </label>
                <p>
                  Your organization administrator is assigned first. This is your company’s
                  helpdesk; no external response time is promised.
                </p>
                <button type="submit" disabled={locked}>
                  Save case
                </button>
              </form>
            ) : detail.value && c ? (
              <>
                <h3>{c.subject}</h3>
                <p class="cs-support-status">{statusText[c.status]}</p>
                <p>
                  {topics[c.topic]} ·{" "}
                  {c.assignee.available
                    ? `Assigned to ${c.assignee.name}`
                    : "The assigned person is no longer available. An administrator or finance colleague must reassign this case."}
                </p>
                {c.statement && (
                  <div class="cs-support-context">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onOpenStatement(c.statement!.id)}
                    >
                      Open linked statement
                    </button>
                    <details>
                      <summary>Original statement snapshot</summary>
                      <code>{c.statement.snapshotSha256}</code>
                      <p>
                        This reference stays fixed when a correction is approved. The statement
                        shows the financial history.
                      </p>
                    </details>
                  </div>
                )}
                {detail.value.olderBefore && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      void read(async () => {
                        const page = await serviceRequest<SupportCaseDetail>(
                          `${root}/${c.id}?eventsBefore=${detail.value!.olderBefore}`,
                        );
                        detail.value = {
                          ...detail.value!,
                          olderBefore: page.olderBefore,
                          events: [...page.events, ...detail.value!.events],
                        };
                      })
                    }
                  >
                    Load earlier replies
                  </button>
                )}
                <ol class="cs-support-history">
                  {detail.value.events.map((event) => (
                    <li key={event.id}>
                      <div>
                        <strong>{event.actor.name}</strong>
                        <span>
                          {eventNames[event.action]} · {time(event.createdAt)}
                        </span>
                      </div>
                      {event.message && <p>{event.message}</p>}
                      {event.assigneeId && event.action === "assign" && (
                        <p>
                          Assigned person:{" "}
                          {data.value?.assignees.find((item) => item.id === event.assigneeId)
                            ?.name ?? "Previously assigned colleague"}
                        </p>
                      )}
                      {event.resolution && (
                        <p>
                          Resolution:{" "}
                          {
                            {
                              "answer-provided": "Answer provided",
                              "record-reviewed": "Record reviewed",
                              "external-follow-up-complete": "External follow-up completed",
                            }[event.resolution]
                          }
                          . Payment status stays separate.
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <h3>{c.status === "closed" ? "Need more help?" : "Next action"}</h3>
                  <label>
                    Action
                    <select
                      disabled={locked}
                      value={action.value}
                      onChange={(event) => {
                        action.value = event.currentTarget.value;
                        confirmed.value = false;
                      }}
                    >
                      <option value="" disabled>
                        Choose an action
                      </option>
                      {c.status !== "closed" && <option value="reply">Add a reply</option>}
                      {staff && c.status !== "closed" && (
                        <option value="assign">Assign a colleague</option>
                      )}
                      {responsible && c.status !== "closed" && (
                        <>
                          <option value="request-information">
                            Ask the reporter for information
                          </option>
                          <option value="resolve">Propose a resolution</option>
                        </>
                      )}
                      {reporter && c.status === "resolved" && (
                        <option value="close">Confirm the resolution and close</option>
                      )}
                      {reporter && ["resolved", "closed"].includes(c.status) && (
                        <option value="reopen">Reopen the case</option>
                      )}
                    </select>
                  </label>
                  {action.value === "assign" ? (
                    <label>
                      Assigned person
                      <select
                        required
                        value={assignee.value}
                        disabled={locked}
                        onChange={(event) => {
                          assignee.value = event.currentTarget.value;
                        }}
                      >
                        {data.value.assignees.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : action.value === "close" ? (
                    <label class="cs-support-confirm">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed.value}
                        disabled={locked}
                        onChange={(event) => {
                          confirmed.value = event.currentTarget.checked;
                        }}
                      />
                      {SUPPORT_CLOSE_CONFIRMATION}
                    </label>
                  ) : (
                    <label>
                      {action.value === "resolve"
                        ? "Explain what was checked and resolved"
                        : "Message"}
                      <textarea
                        required
                        maxLength={2000}
                        rows={5}
                        disabled={locked}
                        value={message.value}
                        onInput={(event) => {
                          message.value = event.currentTarget.value;
                        }}
                      />
                    </label>
                  )}
                  {action.value === "resolve" && (
                    <label>
                      Resolution
                      <select
                        value={resolution.value}
                        disabled={locked}
                        onChange={(event) => {
                          resolution.value = event.currentTarget.value;
                        }}
                      >
                        <option value="answer-provided">Answer provided</option>
                        <option value="record-reviewed">Record reviewed</option>
                        <option value="external-follow-up-complete">
                          External follow-up completed
                        </option>
                      </select>
                    </label>
                  )}
                  <button
                    type="submit"
                    disabled={
                      locked ||
                      !action.value ||
                      (c.status === "closed" && action.value !== "reopen")
                    }
                  >
                    Save update
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void read(() => open(c.id))}
                  >
                    Reload current case
                  </button>
                </form>
              </>
            ) : (
              <p>Select a case to read its history, or open a new one.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
