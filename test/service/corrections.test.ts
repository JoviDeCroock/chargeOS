import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { totp, signedIn } from "./helpers.js";
import {
  fixture,
  draft,
  approve,
  csv,
  mapping,
  period,
  enroll,
  from,
  until,
} from "./reimbursement-helpers.js";
import type {
  ReimbursementPolicy,
  ReimbursementStatement,
  ReimbursementWorkspaceData,
} from "../../shared/contracts.js";

async function original() {
  const f = await fixture(),
    statement = await draft(f);
  const response = await approve(f, statement);
  expect(response.status, await response.clone().text()).toBe(200);
  return { ...f, original: await response.json<ReimbursementStatement>() };
}
const only = (session: string) =>
  csv
    .split("\n")
    .filter((line, index) => index === 0 || line.startsWith(`${session},`))
    .join("\n");
async function correction(
  f: Awaited<ReturnType<typeof original>>,
  previous = f.original,
  source = only("S-1"),
  extra: Record<string, unknown> = {},
) {
  return draft(f, source, {
    correctionOf: previous.id,
    correctionReason: "source-issue",
    ...extra,
  });
}
async function apply(f: Awaited<ReturnType<typeof original>>, statement: ReimbursementStatement) {
  return f.finance.browser.request(`${f.root}/statements/${statement.id}/approve`, {
    snapshotSha256: statement.snapshotSha256,
    previousSnapshotSha256: statement.snapshot.correction?.previousSnapshotSha256,
    authenticatorCode: await totp(f.financeTotpUri!),
  });
}
const workspace = async (f: Awaited<ReturnType<typeof original>>) =>
  (await f.finance.browser.request(f.root)).json<ReimbursementWorkspaceData>();
async function voidDraft(
  f: Awaited<ReturnType<typeof original>>,
  previous: ReimbursementStatement,
) {
  const response = await f.admin.browser.request(`${f.root}/statements/${previous.id}/void-draft`, {
    snapshotSha256: previous.snapshotSha256,
    reason: "eligibility",
  });
  expect([200, 201], await response.clone().text()).toContain(response.status);
  return response.json<ReimbursementStatement>();
}

describe("approved statement adjustments", () => {
  it("appends a negative adjustment, preserves both snapshots, keeps reservations, and is idempotent", async () => {
    const f = await original(),
      replacement = await correction(f);
    expect(replacement.amountCents).toBe(50);
    expect(replacement.adjustmentCents).toBe(-83);
    const response = await apply(f, replacement);
    expect(response.status, await response.clone().text()).toBe(200);
    const current = await response.json<ReimbursementStatement>();
    expect(current.adjustment!.receipt.differenceCents).toBe(-83);
    expect(current.adjustment!.receipt.previousSnapshotSha256).toBe(f.original.snapshotSha256);
    expect(current.snapshot).toEqual(replacement.snapshot);
    const old = await (
      await f.admin.browser.request(`${f.root}/statements/${f.original.id}`)
    ).json<ReimbursementStatement>();
    expect(old.status).toBe("approved");
    expect(old.snapshot).toEqual(f.original.snapshot);
    expect(old.supersededBy).toBe(current.id);
    const data = await workspace(f);
    expect(data.journal.map((item) => item.differenceCents).sort((a, b) => a - b)).toEqual([
      -83, 133,
    ]);
    expect(data.balances[0]?.approvedAmountCents).toBe(50);
    expect(data.balances[0]?.paymentStatus).toBe("not-instructed");
    expect((await apply(f, replacement)).status).toBe(200);
    expect((await correction(f)).id).toBe(current.id);
    expect((await workspace(f)).journal).toHaveLength(2);
    const claims = await env.SERVICE_DB.prepare(
      "SELECT statement_id FROM reimbursement_claim WHERE organization_id=?",
    )
      .bind(f.org.id)
      .all<{ statement_id: string }>();
    expect(claims.results).toHaveLength(2);
    expect(claims.results.every((row) => row.statement_id === f.original.id)).toBe(true);
  });
  it("chains a new published rate and full cancellation without releasing sessions or implying payment", async () => {
    const f = await original();
    const published = await f.admin.browser.request(`${f.root}/policies`, {
      key: "home-energy",
      version: "2",
      name: "Corrected agreed rate",
      effectiveFrom: from,
      effectiveUntil: until,
      rateEurPerKwh: "0.4",
    });
    expect(published.status).toBe(201);
    const policy = await published.json<ReimbursementPolicy>();
    const repriced = await correction(f, f.original, csv, {
      correctionReason: "policy-rate",
      correctionPolicyVersionId: policy.id,
    });
    expect(repriced.amountCents).toBe(160);
    expect(repriced.snapshot.assignment.policyVersionId).toBe(f.policy.id);
    expect(repriced.snapshot.policy.version).toBe("2");
    const response = await apply(f, repriced);
    expect(response.status, await response.clone().text()).toBe(200);
    const next = await response.json<ReimbursementStatement>();
    expect(next.adjustment?.receipt.differenceCents).toBe(27);
    const cancellation = await voidDraft(f, next);
    expect(cancellation.amountCents).toBe(0);
    expect(cancellation.snapshot.sourceAuthority).toBe("finance-void-request");
    expect(cancellation.adjustmentCents).toBe(-160);
    const cancelledResponse = await apply(f, cancellation);
    expect(cancelledResponse.status, await cancelledResponse.clone().text()).toBe(200);
    const cancelled = await cancelledResponse.json<ReimbursementStatement>();
    expect(cancelled.adjustment?.receipt.previousAdjustmentSha256).toBe(next.adjustment?.sha256);
    expect(cancelled.paymentStatus).toBe("not-instructed");
    const data = await workspace(f);
    expect(data.journal.reduce((sum, item) => sum + item.differenceCents, 0)).toBe(0);
    expect(data.balances[0]?.approvedAmountCents).toBe(0);
    expect(data.journal).toHaveLength(3);
    const independent = await draft(f, csv.replaceAll("DO-NOT-PERSIST", "OTHER-SOURCE-BYTES"));
    expect((await approve(f, independent)).status).toBe(409);
  });
  it("allows only one competing correction and one audit for parallel retries", async () => {
    const f = await original(),
      first = await correction(f),
      second = await correction(f, f.original, only("S-2"));
    const responses = await Promise.all([apply(f, first), apply(f, second)]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    const data = await workspace(f);
    expect(data.journal).toHaveLength(2);
    const winner = data.statements.find(
      (item) => item.status === "approved" && item.correctionOf === f.original.id,
    )!;
    const winnerDetail = await (
      await f.finance.browser.request(`${f.root}/statements/${winner.id}`)
    ).json<ReimbursementStatement>();
    expect(
      (await Promise.all([apply(f, winnerDetail), apply(f, winnerDetail)])).map(
        (item) => item.status,
      ),
    ).toEqual([200, 200]);
    const audit = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM service_audit WHERE organization_id=? AND action='statement.adjusted'",
    )
      .bind(f.org.id)
      .first<{ count: number }>();
    expect(audit!.count).toBe(1);
    const stale = await f.admin.browser.request(
      `${f.root}/statements/${f.original.id}/void-draft`,
      { snapshotSha256: f.original.snapshotSha256, reason: "eligibility" },
    );
    expect(stale.status).toBe(409);
  });
  it("requires a different creator/reviewer, current MFA, both hashes, and tenant/employee scope", async () => {
    const f = await original(),
      stranger = await signedIn();
    const response = await f.finance.browser.request(`${f.root}/statements`, {
      assignmentId: f.assignment.id,
      ...period,
      csvBase64: btoa(only("S-1")),
      mapping,
      revisionOf: null,
      correctionOf: f.original.id,
      correctionReason: "source-issue",
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const replacement = await response.json<ReimbursementStatement>();
    expect((await apply(f, replacement)).status).toBe(403);
    expect((await stranger.browser.request(`${f.root}/statements/${replacement.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await stranger.browser.request(`${f.root}/statements/${f.original.id}/void-draft`, {
          snapshotSha256: f.original.snapshotSha256,
          reason: "eligibility",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.driver.browser.request(`${f.root}/statements/${f.original.id}/void-draft`, {
          snapshotSha256: f.original.snapshotSha256,
          reason: "eligibility",
        })
      ).status,
    ).toBe(403);
    const uri = await enroll(f.admin.browser);
    const body = {
      snapshotSha256: replacement.snapshotSha256,
      previousSnapshotSha256: "0".repeat(64),
      authenticatorCode: await totp(uri),
    };
    expect(
      (await f.admin.browser.request(`${f.root}/statements/${replacement.id}/approve`, body))
        .status,
    ).toBe(409);
    expect(
      (
        await f.admin.browser.request(`${f.root}/statements/${replacement.id}/approve`, {
          ...body,
          previousSnapshotSha256: f.original.snapshotSha256,
          authenticatorCode: "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.admin.browser.request(`${f.root}/statements/${replacement.id}/approve`, {
          ...body,
          previousSnapshotSha256: f.original.snapshotSha256,
        })
      ).status,
    ).toBe(200);
    const own = await (await f.driver.browser.request(f.root)).json<ReimbursementWorkspaceData>();
    expect(own.journal.every((item) => item.employeeId === f.assignment.employeeId)).toBe(true);
    expect(own.balances).toHaveLength(1);
  });
  it("resolves a changed eligibility interval with a new reviewed snapshot while preserving the old amount", async () => {
    const f = await original(),
      stale = await correction(f);
    expect(
      (
        await f.admin.browser.request(`${f.root}/assignments/${f.assignment.id}/end`, {
          effectiveUntil: "2026-09-15T00:00:00Z",
        })
      ).status,
    ).toBe(200);
    expect((await apply(f, stale)).status).toBe(409);
    expect((await workspace(f)).balances[0]?.needsReviewAmountCents).toBe(133);
    const fresh = await correction(f, f.original, csv, { periodUntil: "2026-09-15T00:00:00Z" });
    expect(fresh.amountCents).toBe(50);
    expect(fresh.eligibilityChanged).toBe(false);
    expect((await apply(f, fresh)).status).toBe(200);
    const data = await workspace(f);
    expect(data.balances[0]?.approvedAmountCents).toBe(50);
    expect(data.balances[0]?.needsReviewAmountCents).toBe(0);
    const old = data.statements.find((item) => item.id === f.original.id)!;
    expect(old.amountCents).toBe(133);
    expect(old.supersededBy).toBe(fresh.id);
  });
  it("does not borrow another statement's reservations and can reserve new sessions for the same root", async () => {
    const f = await original(),
      other = await draft(f, csv.replaceAll("S-1", "OTHER-1").replaceAll("S-2", "OTHER-2"));
    expect((await approve(f, other)).status).toBe(200);
    const conflict = await correction(f, f.original, csv.replaceAll("S-2", "OTHER-2"));
    expect((await apply(f, conflict)).status).toBe(409);
    expect((await workspace(f)).balances[0]?.approvedAmountCents).toBe(266);
    const replacement = await correction(
      f,
      f.original,
      csv + "\nS-3,HOME-1,employee-1,2026-09-25T10:00:00Z,2026-09-25T11:00:00Z,1,DO-NOT-PERSIST",
    );
    expect(replacement.amountCents).toBe(166);
    expect((await apply(f, replacement)).status).toBe(200);
    expect((await workspace(f)).balances[0]?.approvedAmountCents).toBe(299);
  });
  it("fails closed on an edited adjustment receipt or a denormalized amount mismatch", async () => {
    const f = await original(),
      replacement = await correction(f);
    expect((await apply(f, replacement)).status).toBe(200);
    await env.SERVICE_DB.prepare(
      "UPDATE reimbursement_adjustment SET receipt_json=replace(receipt_json,'source-issue','needs-review') WHERE replacement_statement_id=?",
    )
      .bind(replacement.id)
      .run();
    expect((await f.finance.browser.request(f.root)).status).toBe(409);
    expect((await f.driver.browser.request(`${f.root}/statements/${replacement.id}`)).status).toBe(
      409,
    );
    const g = await original();
    await env.SERVICE_DB.prepare("UPDATE reimbursement_statement SET amount_cents=999 WHERE id=?")
      .bind(g.original.id)
      .run();
    expect((await g.finance.browser.request(g.root)).status).toBe(409);
  });
});

it("retains a rejected cancellation and links its separately approved revision", async () => {
  const f = await original(),
    cancelled = await voidDraft(f, f.original);
  expect(
    (
      await f.finance.browser.request(`${f.root}/statements/${cancelled.id}/reject`, {
        snapshotSha256: cancelled.snapshotSha256,
        reason: "needs-review",
      })
    ).status,
  ).toBe(200);
  const response = await f.admin.browser.request(
    `${f.root}/statements/${f.original.id}/void-draft`,
    { snapshotSha256: f.original.snapshotSha256, reason: "eligibility", revisionOf: cancelled.id },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const revised = await response.json<ReimbursementStatement>();
  expect(revised.revisionOf).toBe(cancelled.id);
  expect((await apply(f, revised)).status).toBe(200);
  const data = await workspace(f);
  expect(data.balances[0]?.approvedAmountCents).toBe(0);
  expect(data.journal).toHaveLength(2);
  expect(data.statements.find((item) => item.id === cancelled.id)?.status).toBe("rejected");
});
