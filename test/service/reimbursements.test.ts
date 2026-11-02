import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, signedIn, createOrganization, totp } from "./helpers.js";
import {
  mapping,
  from,
  until,
  period,
  csv,
  enroll,
  fixture,
  draft,
  approve,
} from "./reimbursement-helpers.js";
import type {
  ReimbursementAssignment,
  ReimbursementStatement,
  ReimbursementWorkspaceData,
  ServiceAccount,
} from "../../shared/contracts.js";

describe("durable reimbursement review", () => {
  it("calculates server-side exact cents, preserves byte provenance, minimizes other people's data, and freezes approval separately from payment", async () => {
    const f = await fixture();
    const statement = await draft(f);
    expect(statement.amountCents).toBe(133); // 1500Wh × 0.33 => 49.5c -> 50c; 2500Wh => 82.5c -> 83c.
    expect(statement.energyWh).toBe(4000);
    expect(statement.snapshot.counts).toEqual({ included: 2, duplicate: 1, held: 0, excluded: 0 });
    expect(statement.snapshot.omittedRecords).toBe(1);
    expect(JSON.stringify(statement)).not.toMatch(/DO-NOT-PERSIST|someone-else|OTHER-HOME|PRIVATE/);
    const sourceHash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv))),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    expect(statement.snapshot.sources[0]?.sha256).toBe(sourceHash);
    expect((await draft(f)).id).toBe(statement.id);
    const response = await approve(f, statement);
    expect(response.status, await response.clone().text()).toBe(200);
    const approved = await response.json<ReimbursementStatement>();
    expect(approved.status).toBe("approved");
    expect(approved.paymentStatus).toBe("not-instructed");
    expect(approved.snapshotSha256).toBe(statement.snapshotSha256);
    expect(approved.snapshot).toEqual(statement.snapshot);
    expect((await approve(f, statement)).status).toBe(200);
    const audit = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM service_audit WHERE action = 'statement.approved' AND subject_id = ?",
    )
      .bind(statement.id)
      .first<{ count: number }>();
    expect(audit!.count).toBe(1);
  });
  it("isolates organization and employee views and rejects driver, finance-assignment, and self-approval escalation", async () => {
    const f = await fixture();
    const statement = await draft(f);
    const outsider = await signedIn();
    expect((await outsider.browser.request(f.root)).status).toBe(404);
    expect((await outsider.browser.request(`${f.root}/statements/${statement.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await outsider.browser.request(`${f.root}/statements/${statement.id}/approve`, {
          snapshotSha256: statement.snapshotSha256,
        })
      ).status,
    ).toBe(404);
    expect((await f.driver.browser.request(`${f.root}/policies`, {})).status).toBe(403);
    expect(
      (
        await f.driver.browser.request(`${f.root}/statements/${statement.id}/approve`, {
          snapshotSha256: statement.snapshotSha256,
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.finance.browser.request(`${f.root}/assignments`, f.assignmentBody)).status,
    ).toBe(403);
    const adminMe = await (await f.admin.browser.request(api + "/me")).json<ServiceAccount>();
    const adminAssignmentResponse = await f.admin.browser.request(f.root + "/assignments", {
      ...f.assignmentBody,
      employeeId: adminMe.user.id,
      driverAlias: "admin-alias",
      stationAlias: "ADMIN-HOME",
    });
    expect(adminAssignmentResponse.status).toBe(201);
    const adminAssignment = await adminAssignmentResponse.json<ReimbursementAssignment>();
    const adminStatement = await draft(
      f,
      csv.replaceAll("employee-1", "admin-alias").replaceAll("HOME-1", "ADMIN-HOME"),
      { assignmentId: adminAssignment.id },
    );
    expect(
      (await f.driver.browser.request(f.root + "/statements/" + adminStatement.id)).status,
    ).toBe(404);
    const own = await (await f.driver.browser.request(f.root)).json<ReimbursementWorkspaceData>();
    expect(own.employees).toEqual([]);
    expect(own.assignments).toHaveLength(1);
    expect(own.statements).toHaveLength(1);
    const driverId = own.assignments[0]!.employeeId;
    await env.SERVICE_DB.prepare(
      "UPDATE membership SET role = 'finance' WHERE organization_id = ? AND user_id = ?",
    )
      .bind(f.org.id, driverId)
      .run();
    expect(
      (
        await f.driver.browser.request(`${f.root}/statements/${statement.id}/approve`, {
          snapshotSha256: statement.snapshotSha256,
        })
      ).status,
    ).toBe(403);
  });
  it("refuses approval by the finance member who created the draft", async () => {
    const f = await fixture();
    const created = await f.finance.browser.request(`${f.root}/statements`, {
      assignmentId: f.assignment.id,
      ...period,
      csvBase64: btoa(csv),
      mapping,
      revisionOf: null,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const statement = await created.json<ReimbursementStatement>();
    const response = await approve(f, statement);
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/different finance reviewer/);
    expect(
      await env.SERVICE_DB.prepare(
        "SELECT count(*) AS count FROM reimbursement_claim WHERE statement_id = ?",
      )
        .bind(statement.id)
        .first("count"),
    ).toBe(0);
  });
  it("locks approval step-up after repeated wrong authenticator codes from a signed-in session", async () => {
    const f = await fixture();
    const statement = await draft(f);
    const wrongCode = async () =>
      String((Number(await totp(f.financeTotpUri!)) + 500_000) % 1_000_000).padStart(6, "0");
    const attempt = async (authenticatorCode: string) =>
      (
        await f.finance.browser.request(`${f.root}/statements/${statement.id}/approve`, {
          snapshotSha256: statement.snapshotSha256,
          authenticatorCode,
        })
      ).status;
    for (let index = 0; index < 10; index += 1) expect(await attempt(await wrongCode())).toBe(403);
    // Even the correct code is refused while the lock holds.
    expect(await attempt(await totp(f.financeTotpUri!))).toBe(429);
    const locked = await env.SERVICE_DB.prepare(
      "SELECT t.failed_verification_count AS count, t.locked_until AS lockedUntil FROM two_factor t JOIN membership m ON m.user_id = t.user_id WHERE m.organization_id = ? AND m.role = 'finance'",
    )
      .bind(f.org.id)
      .first<{ count: number; lockedUntil: number }>();
    expect(locked?.count).toBe(10);
    expect(locked?.lockedUntil).toBeGreaterThan(Date.now());
    await env.SERVICE_DB.prepare("UPDATE two_factor SET locked_until = ? WHERE locked_until = ?")
      .bind(Date.now() - 1, locked!.lockedUntil)
      .run();
    expect(await attempt(await totp(f.financeTotpUri!))).toBe(200);
    const reset = await env.SERVICE_DB.prepare(
      "SELECT failed_verification_count AS count FROM two_factor WHERE locked_until IS NULL AND failed_verification_count = 0",
    ).all();
    expect(reset.results.length).toBeGreaterThan(0);
  });
  it("requires MFA and the reviewed snapshot hash; holds invalid/boundary rows and retains a rejected revision", async () => {
    const f = await fixture(false);
    const clean = await draft(f);
    expect((await approve(f, clean)).status).toBe(403);
    f.financeTotpUri = await enroll(f.finance.browser);
    expect(
      (
        await f.finance.browser.request(`${f.root}/statements/${clean.id}/approve`, {
          snapshotSha256: clean.snapshotSha256,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.finance.browser.request(`${f.root}/statements/${clean.id}/approve`, {
          snapshotSha256: "0".repeat(64),
        })
      ).status,
    ).toBe(409);
    const badCsv =
      csv +
      "\nCROSS,HOME-1,employee-1,2026-08-31T23:00:00Z,2026-09-01T01:00:00Z,2,DO-NOT-PERSIST\nBAD,HOME-1,employee-1,not-a-date,2026-09-01T01:00:00Z,2,DO-NOT-PERSIST";
    const held = await draft(f, badCsv);
    expect(held.heldRecords).toBe(1);
    expect(held.invalidRecords).toBe(1);
    expect((await approve(f, held)).status).toBe(409);
    expect(
      (
        await f.finance.browser.request(`${f.root}/statements/${held.id}/reject`, {
          snapshotSha256: held.snapshotSha256,
          reason: "source-issue",
        })
      ).status,
    ).toBe(200);
    const revised = await draft(f, csv, { revisionOf: held.id });
    expect(revised.id).not.toBe(held.id);
    expect(revised.revisionOf).toBe(held.id);
    const original = await (
      await f.admin.browser.request(`${f.root}/statements/${held.id}`)
    ).json<ReimbursementStatement>();
    expect(original.status).toBe("rejected");
    expect(original.snapshot).toEqual(held.snapshot);
    expect((await approve(f, revised)).status).toBe(200);
  });
  it("atomically prevents the same station/session being approved from two different imports", async () => {
    const f = await fixture();
    const first = await draft(f);
    const second = await draft(f, csv.replaceAll("DO-NOT-PERSIST", "DIFFERENT-UNSELECTED-DATA"));
    expect(second.id).not.toBe(first.id);
    const attempts = await Promise.all([approve(f, first), approve(f, second)]);
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
    const claims = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM reimbursement_claim WHERE organization_id = ?",
    )
      .bind(f.org.id)
      .first<{ count: number }>();
    expect(claims!.count).toBe(2);
    const approvals = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM service_audit WHERE action = 'statement.approved' AND organization_id = ?",
    )
      .bind(f.org.id)
      .first<{ count: number }>();
    expect(approvals!.count).toBe(1);
  });
  it("preserves assignment history and approved snapshots, while ending eligibility invalidates existing drafts", async () => {
    const f = await fixture();
    const approved = await draft(f);
    expect((await approve(f, approved)).status).toBe(200);
    const pending = await draft(f, csv.replaceAll("S-1", "S-3").replaceAll("S-2", "S-4"));
    const ended = await f.admin.browser.request(`${f.root}/assignments/${f.assignment.id}/end`, {
      effectiveUntil: "2026-09-15T00:00:00Z",
    });
    expect(ended.status).toBe(200);
    expect((await ended.json<ReimbursementAssignment>()).originalUntil).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect((await approve(f, pending)).status).toBe(409);
    const old = await (
      await f.finance.browser.request(`${f.root}/statements/${approved.id}`)
    ).json<ReimbursementStatement>();
    expect(old.status).toBe("approved");
    expect(old.eligibilityChanged).toBe(true);
    expect(old.snapshot).toEqual(approved.snapshot);
    expect(
      (
        await f.admin.browser.request(`${f.root}/assignments/${f.assignment.id}/end`, {
          effectiveUntil: "2026-09-16T00:00:00Z",
        })
      ).status,
    ).toBe(409);
  });
  it("closes future assignments atomically with membership removal without erasing financial history", async () => {
    const f = await fixture();
    const pending = await draft(f);
    const member = await env.SERVICE_DB.prepare(
      "SELECT id FROM membership WHERE organization_id = ? AND user_id = ?",
    )
      .bind(f.org.id, f.assignment.employeeId)
      .first<{ id: string }>();
    expect(
      (
        await f.admin.browser.request(
          `${api}/organizations/${f.org.id}/members/${member!.id}`,
          {},
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect((await f.driver.browser.request(f.root)).status).toBe(404);
    expect((await approve(f, pending)).status).toBe(409);
    const assignments = await (
      await f.finance.browser.request(f.root)
    ).json<ReimbursementWorkspaceData>();
    expect(assignments.assignments[0]!.ended).toBe(true);
    expect(assignments.statements[0]!.eligibilityChanged).toBe(true);
  });
  it("rejects forged totals, corrupt snapshots, invalid bytes, future periods, cross-tenant references, and assignment races", async () => {
    const f = await fixture();
    const payload = {
      assignmentId: f.assignment.id,
      ...period,
      csvBase64: btoa(csv),
      mapping,
      revisionOf: null,
    };
    expect(
      (
        await f.admin.browser.request(`${f.root}/statements`, {
          ...payload,
          mapping: { ...mapping, sessionId: "rfid" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.admin.browser.request(`${f.root}/statements`, { ...payload, amountCents: 999999 }))
        .status,
    ).toBe(400);
    expect(
      (await f.admin.browser.request(`${f.root}/statements`, { ...payload, csvBase64: "////" }))
        .status,
    ).toBe(400);
    expect(
      (
        await f.admin.browser.request(`${f.root}/statements`, {
          ...payload,
          periodFrom: new Date(Date.now() + 86400000).toISOString(),
          periodUntil: new Date(Date.now() + 172800000).toISOString(),
        })
      ).status,
    ).toBe(400);
    const other = await createOrganization(f.admin.browser, "Unrelated policy scope");
    expect(
      (
        await f.admin.browser.request(
          `${api}/organizations/${other.id}/money/assignments`,
          f.assignmentBody,
        )
      ).status,
    ).toBe(409);
    const races = await Promise.all([
      f.admin.browser.request(`${f.root}/assignments`, {
        ...f.assignmentBody,
        stationAlias: "SECOND-HOME",
      }),
      f.admin.browser.request(`${f.root}/assignments`, {
        ...f.assignmentBody,
        stationAlias: "SECOND-HOME",
      }),
    ]);
    expect(races.map((r) => r.status).sort()).toEqual([201, 409]);
    const statement = await draft(f);
    await env.SERVICE_DB.prepare(
      "UPDATE reimbursement_statement SET snapshot_json = replace(snapshot_json,'Selected session export','changed source label') WHERE id = ?",
    )
      .bind(statement.id)
      .run();
    expect((await f.admin.browser.request(`${f.root}/statements/${statement.id}`)).status).toBe(
      409,
    );
    expect((await approve(f, statement)).status).toBe(409);
  });
});

it("keeps published policy versions immutable and requires explicit source assignment without an employee column", async () => {
  const f = await fixture(false);
  const policyBody = {
    key: "home-energy",
    version: "1",
    name: "Changed rate",
    effectiveFrom: from,
    effectiveUntil: until,
    rateEurPerKwh: "9.99",
  };
  expect((await f.admin.browser.request(`${f.root}/policies`, policyBody)).status).toBe(409);
  expect(
    (
      await f.admin.browser.request(`${f.root}/policies`, {
        ...policyBody,
        version: "2",
        rateEurPerKwh: "0.4",
      })
    ).status,
  ).toBe(201);
  const source = csv
    .split("\n")
    .map((line) => {
      const fields = line.split(",");
      fields.splice(2, 1);
      return fields.join(",");
    })
    .join("\n");
  const body = {
    assignmentId: f.assignment.id,
    ...period,
    csvBase64: btoa(source),
    mapping: { ...mapping, driverAlias: null },
    revisionOf: null,
  };
  expect((await f.admin.browser.request(`${f.root}/statements`, body)).status).toBe(400);
  const response = await f.admin.browser.request(`${f.root}/statements`, {
    ...body,
    driverDeclarationConfirmed: true,
  });
  expect(response.status).toBe(201);
  const statement = await response.json<ReimbursementStatement>();
  expect(statement.amountCents).toBe(133);
  expect(statement.snapshot.policy.rateEurPerKwh).toBe("0.33");
  expect(statement.snapshot.policy.version).toBe("1");
  expect(statement.snapshot.decisions[0]?.session.driverAssignment).toBe("declared-for-import");
});
