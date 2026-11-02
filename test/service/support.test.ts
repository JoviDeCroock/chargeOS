import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { api, createOrganization, invite, signedIn, type Browser } from "./helpers.js";
import { fixture, draft, approve } from "./reimbursement-helpers.js";
import type {
  ServiceAccount,
  SupportCaseDetail,
  SupportWorkspaceData,
} from "../../shared/contracts.js";
import { SUPPORT_CLOSE_CONFIRMATION } from "../../shared/support.js";
import { validateSupportHistory } from "../../service/support-history.js";
import { handleSupport } from "../../service/support.js";
import { financialJournal, readFinancialData } from "../../service/reimbursement-journal.js";

const createBody = (statementId: string | null = null) => ({
  mutationId: crypto.randomUUID(),
  subject: "Check September reimbursement",
  topic: "statement-amount",
  statementId,
  message: "The source total differs. Please check the agreed policy.",
});
const update = (
  browser: Browser,
  root: string,
  c: SupportCaseDetail,
  action: string,
  extra: Record<string, unknown> = {},
) =>
  browser.request(`${root}/${c.case.id}/${action}`, {
    mutationId: crypto.randomUUID(),
    expectedRevision: c.case.revision,
    ...extra,
  });
async function setup() {
  const admin = await signedIn(),
    driver = await signedIn(),
    other = await signedIn(),
    finance = await signedIn(),
    org = await createOrganization(admin.browser, "Synthetic case employer");
  for (const [person, role] of [
    [driver, "driver"],
    [other, "driver"],
    [finance, "finance"],
  ] as const) {
    const offer = await invite(admin.browser, org, person.email, role);
    expect(
      (await person.browser.request(`${api}/invitations/accept`, { token: offer.token })).status,
    ).toBe(200);
  }
  const root = `${api}/organizations/${org.id}/support`,
    body = createBody();
  const response = await driver.browser.request(root, body);
  expect(response.status, await response.clone().text()).toBe(201);
  return {
    admin,
    driver,
    other,
    finance,
    org,
    root,
    body,
    c: await response.json<SupportCaseDetail>(),
  };
}
it("gives each case an accountable person, keeps replies and requires the reporter to confirm the current resolution", async () => {
  const f = await setup();
  expect(f.c.case.assignee.name).toBe("Test Person");
  expect(f.c.case.assignee.available).toBe(true);
  const finance = (await (await f.finance.browser.request(`${api}/me`)).json<ServiceAccount>()).user
    .id;
  let response = await update(f.admin.browser, f.root, f.c, "assign", { assigneeId: finance });
  expect(response.status).toBe(200);
  let c = await response.json<SupportCaseDetail>();
  expect(
    (await update(f.other.browser, f.root, c, "reply", { message: "Do not disclose" })).status,
  ).toBe(404);
  response = await update(f.finance.browser, f.root, c, "request-information", {
    message: "Which session is missing?",
  });
  expect(response.status).toBe(200);
  c = await response.json<SupportCaseDetail>();
  expect(c.case.status).toBe("waiting-for-reporter");
  response = await update(f.driver.browser, f.root, c, "reply", {
    message: "Session S-2 in my approved statement.",
  });
  c = await response.json<SupportCaseDetail>();
  expect(c.case.status).toBe("open");
  response = await update(f.finance.browser, f.root, c, "resolve", {
    message: "The statement and agreed rate have been explained.",
    resolution: "answer-provided",
  });
  expect(response.status).toBe(200);
  c = await response.json<SupportCaseDetail>();
  expect(c.case.status).toBe("resolved");
  expect(
    (
      await update(f.admin.browser, f.root, c, "close", {
        confirmation: SUPPORT_CLOSE_CONFIRMATION,
      })
    ).status,
  ).toBe(403);
  const resolved = c;
  response = await update(f.driver.browser, f.root, c, "reopen", {
    message: "I still need the session detail.",
  });
  expect(response.status).toBe(200);
  c = await response.json<SupportCaseDetail>();
  expect(
    (
      await update(f.driver.browser, f.root, resolved, "close", {
        confirmation: SUPPORT_CLOSE_CONFIRMATION,
      })
    ).status,
  ).toBe(409);
  response = await update(f.finance.browser, f.root, c, "resolve", {
    message: "The missing detail is now explained.",
    resolution: "record-reviewed",
  });
  c = await response.json<SupportCaseDetail>();
  response = await update(f.driver.browser, f.root, c, "close", {
    confirmation: SUPPORT_CLOSE_CONFIRMATION,
  });
  expect(response.status).toBe(200);
  c = await response.json<SupportCaseDetail>();
  expect(c.case.status).toBe("closed");
  expect(c.events).toHaveLength(8);
  expect(
    (await update(f.finance.browser, f.root, c, "reply", { message: "After closure" })).status,
  ).toBe(409);
  await validateSupportHistory(env);
});
it("scopes every case and retry to the current tenant, reporter and role while retaining departed staff history", async () => {
  const f = await setup(),
    outsider = await signedIn();
  expect((await outsider.browser.request(`${f.root}/${f.c.case.id}`)).status).toBe(404);
  const own = await (await f.other.browser.request(f.root)).json<SupportWorkspaceData>();
  expect(own.cases).toEqual([]);
  expect(own.assignees).toEqual([]);
  expect((await f.other.browser.request(`${f.root}/${f.c.case.id}`)).status).toBe(404);
  const before = await f.finance.browser.request(`${f.root}/${f.c.case.id}`);
  expect(before.status).toBe(200);
  const financeId = (await (await f.finance.browser.request(`${api}/me`)).json<ServiceAccount>())
    .user.id;
  const assigned = await update(f.admin.browser, f.root, f.c, "assign", { assigneeId: financeId });
  const c = await assigned.json<SupportCaseDetail>();
  await env.SERVICE_DB.prepare(
    "UPDATE membership SET role='driver' WHERE organization_id=? AND user_id=?",
  )
    .bind(f.org.id, financeId)
    .run();
  expect((await f.finance.browser.request(`${f.root}/${c.case.id}`)).status).toBe(404);
  expect(
    (await (await f.driver.browser.request(`${f.root}/${c.case.id}`)).json<SupportCaseDetail>())
      .case.assignee.available,
  ).toBe(false);
  expect(
    (await update(f.admin.browser, f.root, c, "assign", { assigneeId: financeId })).status,
  ).toBe(409);
  const driverId = c.case.reporter.id;
  await env.SERVICE_DB.prepare("DELETE FROM membership WHERE organization_id=? AND user_id=?")
    .bind(f.org.id, driverId)
    .run();
  expect((await f.driver.browser.request(f.root, f.body)).status).toBe(404);
  expect((await f.admin.browser.request(`${f.root}/${c.case.id}`)).status).toBe(200);
  await validateSupportHistory(env);
});
it("binds retry identifiers to exact details and commits one event and audit under concurrent replies", async () => {
  const f = await setup();
  const repeated = await f.driver.browser.request(f.root, f.body);
  expect(repeated.status).toBe(200);
  expect((await repeated.json<SupportCaseDetail>()).case.id).toBe(f.c.case.id);
  expect(
    (await f.driver.browser.request(f.root, { ...f.body, message: "Changed reuse" })).status,
  ).toBe(409);
  const body = {
    mutationId: crypto.randomUUID(),
    expectedRevision: 1,
    message: "One reply despite concurrent retries",
  };
  const replies = await Promise.all([
    f.driver.browser.request(`${f.root}/${f.c.case.id}/reply`, body),
    f.driver.browser.request(`${f.root}/${f.c.case.id}/reply`, body),
  ]);
  expect(replies.map((r) => r.status)).toEqual([200, 200]);
  expect(
    await env.SERVICE_DB.prepare("SELECT count(*) AS n FROM service_audit WHERE id=?")
      .bind(`support-${body.mutationId}`)
      .first("n"),
  ).toBe(1);
  expect(
    await env.SERVICE_DB.prepare("SELECT count(*) AS n FROM support_event WHERE case_id=?")
      .bind(f.c.case.id)
      .first("n"),
  ).toBe(2);
  const current = await (
    await f.driver.browser.request(`${f.root}/${f.c.case.id}`)
  ).json<SupportCaseDetail>();
  const competing = await Promise.all([
    update(f.driver.browser, f.root, current, "reply", { message: "Option A" }),
    update(f.admin.browser, f.root, current, "reply", { message: "Option B" }),
  ]);
  expect(competing.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await f.admin.browser.request(`${f.root}/${f.c.case.id}/reply`, body)).status).toBe(409);
  const retry = await f.driver.browser.request(`${f.root}/${f.c.case.id}/reply`, body);
  expect(retry.status).toBe(200);
  expect((await retry.json<SupportCaseDetail>()).case.revision).toBe(3);
  await validateSupportHistory(env);
});
it("links only the reporter's own fixed statement and never changes approvals, amounts or sessions", async () => {
  const f = await fixture(),
    statement = await draft(f);
  expect((await approve(f, statement)).status).toBe(200);
  const root = `${api}/organizations/${f.org.id}/support`,
    before = financialJournal(await readFinancialData(env, f.org.id, "", true));
  expect((await f.finance.browser.request(root, createBody(statement.id))).status).toBe(404);
  const r = await f.driver.browser.request(root, createBody(statement.id));
  expect(r.status, await r.clone().text()).toBe(201);
  const c = await r.json<SupportCaseDetail>();
  expect(c.case.statement).toEqual({ id: statement.id, snapshotSha256: statement.snapshotSha256 });
  expect(
    (
      await update(f.admin.browser, root, c, "resolve", {
        message: "The bank must confirm payment separately.",
        resolution: "answer-provided",
      })
    ).status,
  ).toBe(200);
  expect(financialJournal(await readFinancialData(env, f.org.id, "", true))).toEqual(before);
  expect(JSON.stringify(c)).not.toMatch(/DO-NOT-PERSIST|paymentStatus|cardAlias|csvBase64/);
  await validateSupportHistory(env);
});
it("rechecks SQL access when a previously authorized staff handler loses membership before execution", async () => {
  const f = await setup(),
    financeId = (await (await f.finance.browser.request(`${api}/me`)).json<ServiceAccount>()).user
      .id;
  await env.SERVICE_DB.prepare("DELETE FROM membership WHERE organization_id=? AND user_id=?")
    .bind(f.org.id, financeId)
    .run();
  await expect(
    handleSupport(
      new Request(`http://127.0.0.1:5173${f.root}/${f.c.case.id}`),
      env,
      { ...f.org, role: "finance" },
      financeId,
      f.c.case.id,
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("bounds messages, rejects privilege fields, enforces write admission and pages case history", async () => {
  const f = await setup();
  for (const extra of [
    { reporterId: f.c.case.assignee.id },
    { message: "x".repeat(2001) },
    { message: "secret\u0000control" },
    { statementId: 42 },
    { assigneeId: f.c.case.assignee.id },
  ])
    expect((await f.driver.browser.request(f.root, { ...createBody(), ...extra })).status).toBe(
      400,
    );
  for (let i = 0; i < 4; i++)
    expect((await f.driver.browser.request(f.root, createBody())).status).toBe(201);
  expect((await f.driver.browser.request(f.root, createBody())).status).toBe(409);
  const page = await (
    await f.driver.browser.request(`${f.root}/${f.c.case.id}?eventsBefore=1`)
  ).json<SupportCaseDetail>();
  expect(page.events).toEqual([]);
  expect((await f.driver.browser.request(`${f.root}?beforeTime=1`)).status).toBe(400);
});

it("keeps rollback-clock updates recoverable and rejects edited messages, hashes and orphaned audits", async () => {
  const f = await setup(),
    future = Date.now() + 60000;
  await env.SERVICE_DB.batch([
    env.SERVICE_DB.prepare("UPDATE support_case SET created_at=?,updated_at=? WHERE id=?").bind(
      future,
      future,
      f.c.case.id,
    ),
    env.SERVICE_DB.prepare("UPDATE support_event SET created_at=? WHERE case_id=?").bind(
      future,
      f.c.case.id,
    ),
    env.SERVICE_DB.prepare(
      "UPDATE service_audit SET created_at=? WHERE subject_id=? AND action='support.created'",
    ).bind(future, f.c.case.id),
  ]);
  const r = await update(f.driver.browser, f.root, f.c, "reply", {
    message: "A reply after the host clock moved back",
  });
  expect(r.status, await r.clone().text()).toBe(200);
  const c = await r.json<SupportCaseDetail>();
  expect(c.events[1]!.createdAt).toBe(new Date(future).toISOString());
  await validateSupportHistory(env);
  const e = await env.SERVICE_DB.prepare("SELECT * FROM support_event WHERE id=?")
    .bind(c.events[1]!.id)
    .first<Record<string, unknown>>();
  try {
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind(JSON.stringify({ message: "Edited canonical reply" }), e!.id)
      .run();
    await expect(validateSupportHistory(env)).rejects.toThrow(/binding/);
  } finally {
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind(e!.payload_json, e!.id)
      .run();
  }
  try {
    await env.SERVICE_DB.prepare("UPDATE support_event SET request_sha256=? WHERE id=?")
      .bind("f".repeat(64), e!.id)
      .run();
    await expect(validateSupportHistory(env)).rejects.toThrow(/binding/);
  } finally {
    await env.SERVICE_DB.prepare("UPDATE support_event SET request_sha256=? WHERE id=?")
      .bind(e!.request_sha256, e!.id)
      .run();
  }
  const row = await env.SERVICE_DB.prepare("SELECT * FROM support_case WHERE id=?")
      .bind(c.case.id)
      .first<Record<string, unknown>>(),
    events = await env.SERVICE_DB.prepare(
      "SELECT * FROM support_event WHERE case_id=? ORDER BY revision",
    )
      .bind(c.case.id)
      .all<Record<string, unknown>>();
  try {
    await env.SERVICE_DB.prepare("DELETE FROM support_event WHERE case_id=?").bind(c.case.id).run();
    await expect(validateSupportHistory(env)).rejects.toThrow(/revision/);
    await env.SERVICE_DB.prepare("DELETE FROM support_case WHERE id=?").bind(c.case.id).run();
    await expect(validateSupportHistory(env)).rejects.toThrow(/audit/);
  } finally {
    if (
      !(await env.SERVICE_DB.prepare("SELECT 1 FROM support_case WHERE id=?")
        .bind(c.case.id)
        .first())
    )
      await env.SERVICE_DB.prepare(
        `INSERT INTO support_case(${Object.keys(row!).join(",")}) VALUES(${Object.keys(row!)
          .map(() => "?")
          .join(",")})`,
      )
        .bind(...Object.values(row!))
        .run();
    for (const event of events.results)
      await env.SERVICE_DB.prepare(
        `INSERT INTO support_event(${Object.keys(event).join(",")}) VALUES(${Object.keys(event)
          .map(() => "?")
          .join(",")})`,
      )
        .bind(...Object.values(event))
        .run();
  }
  await validateSupportHistory(env);
});

it("pages more than fifty events without gaps and refuses capacity without deleting history", async () => {
  const f = await setup();
  let c = f.c;
  for (let i = 0; i < 52; i++) {
    if (i % 15 === 0)
      await env.SERVICE_DB.prepare("DELETE FROM rate_limit WHERE key=?")
        .bind(`support:update:${f.org.id}:${f.c.case.reporter.id}`)
        .run();
    const r = await update(f.driver.browser, f.root, c, "reply", { message: `Follow-up ${i + 1}` });
    expect(r.status).toBe(200);
    c = await r.json<SupportCaseDetail>();
  }
  expect(c.events).toHaveLength(50);
  expect(c.events[0]!.revision).toBe(4);
  expect(c.olderBefore).toBe(4);
  const older = await (
    await f.driver.browser.request(`${f.root}/${c.case.id}?eventsBefore=${c.olderBefore}`)
  ).json<SupportCaseDetail>();
  expect(older.events.map((e) => e.revision)).toEqual([1, 2, 3]);
  expect(older.olderBefore).toBeNull();
  // A saturated store may contain historical data that exceeded this new pilot
  // policy. Admission must preserve it, not mutate or silently prune it.
  const original = await env.SERVICE_DB.prepare("SELECT payload_json FROM support_event WHERE id=?")
    .bind(f.body.mutationId)
    .first<string>("payload_json");
  try {
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind("x".repeat(2097152), f.body.mutationId)
      .run();
    expect(
      (await update(f.driver.browser, f.root, c, "reply", { message: "Must not append" })).status,
    ).toBe(409);
    expect(
      await env.SERVICE_DB.prepare("SELECT count(*) AS n FROM support_event WHERE case_id=?")
        .bind(c.case.id)
        .first("n"),
    ).toBe(53);
  } finally {
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind(original, f.body.mutationId)
      .run();
  }
  await validateSupportHistory(env);
});

it("keeps one driver from exhausting organization support capacity for staff and other drivers", async () => {
  const f = await setup();
  const original = await env.SERVICE_DB.prepare("SELECT payload_json FROM support_event WHERE id=?")
    .bind(f.body.mutationId)
    .first<string>("payload_json");
  try {
    // Simulate a driver who already used their personal quota (trailing whitespace keeps the
    // stored event parseable for the staff reply's detail projection).
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind(`${original}${" ".repeat(262144)}`, f.body.mutationId)
      .run();
    expect(
      (await update(f.driver.browser, f.root, f.c, "reply", { message: "Over quota" })).status,
    ).toBe(409);
    expect((await f.other.browser.request(f.root, createBody())).status).toBe(201);
    const staff = await update(f.admin.browser, f.root, f.c, "reply", { message: "Staff answer" });
    expect(staff.status, await staff.clone().text()).toBe(200);
  } finally {
    await env.SERVICE_DB.prepare("UPDATE support_event SET payload_json=? WHERE id=?")
      .bind(original, f.body.mutationId)
      .run();
  }
});
