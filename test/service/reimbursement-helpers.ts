import { expect } from "vitest";
import {
  api,
  auth,
  createOrganization,
  invite,
  password,
  signedIn,
  totp,
  type Browser,
} from "./helpers.js";
import type {
  ReimbursementAssignment,
  ReimbursementPolicy,
  ReimbursementStatement,
  ServiceAccount,
} from "../../shared/contracts.js";

export const mapping = {
  sessionId: "session_id",
  stationId: "station_id",
  driverAlias: "driver_alias",
  startedAt: "started_at",
  endedAt: "ended_at",
  energy: "energy_kwh",
  energyUnit: "kWh",
  decimalSeparator: ".",
};
export const from = "2026-01-01T00:00:00Z",
  until = "2027-01-01T00:00:00Z";
export const period = { periodFrom: "2026-09-01T00:00:00Z", periodUntil: "2026-10-01T00:00:00Z" };
export const csv =
  "session_id,station_id,driver_alias,started_at,ended_at,energy_kwh,rfid\nS-1,HOME-1,employee-1,2026-09-10T10:00:00Z,2026-09-10T11:00:00Z,1.5,DO-NOT-PERSIST\nS-2,HOME-1,employee-1,2026-09-20T10:00:00Z,2026-09-20T11:00:00Z,2.5,DO-NOT-PERSIST\nS-1,HOME-1,employee-1,2026-09-10T10:00:00Z,2026-09-10T11:00:00Z,1.5,DO-NOT-PERSIST\nPRIVATE,OTHER-HOME,someone-else,2026-09-10T10:00:00Z,2026-09-10T11:00:00Z,9.9,DO-NOT-PERSIST";

export async function enroll(browser: Browser) {
  const response = await browser.request(`${auth}/two-factor/enable`, { password, method: "totp" });
  expect(response.status).toBe(200);
  const setup = await response.json<{ totpURI: string }>();
  expect(
    (
      await browser.request(`${auth}/two-factor/verify-totp`, {
        code: await totp(setup.totpURI),
        trustDevice: false,
      })
    ).status,
  ).toBe(200);
  return setup.totpURI;
}
export async function fixture(mfa = true) {
  const admin = await signedIn(),
    finance = await signedIn(),
    driver = await signedIn();
  const org = await createOrganization(admin.browser, "Synthetic reimbursement employer");
  for (const [person, role] of [
    [finance, "finance"],
    [driver, "driver"],
  ] as const) {
    const offer = await invite(admin.browser, org, person.email, role);
    expect(
      (await person.browser.request(`${api}/invitations/accept`, { token: offer.token })).status,
    ).toBe(200);
  }
  const financeTotpUri = mfa ? await enroll(finance.browser) : null;
  const driverMe = await (await driver.browser.request(`${api}/me`)).json<ServiceAccount>();
  const root = `${api}/organizations/${org.id}/money`;
  const policyResponse = await admin.browser.request(`${root}/policies`, {
    key: "home-energy",
    version: "1",
    name: "Agreed test rate",
    effectiveFrom: from,
    effectiveUntil: until,
    rateEurPerKwh: "0.33",
  });
  expect(policyResponse.status, await policyResponse.clone().text()).toBe(201);
  const policy = await policyResponse.json<ReimbursementPolicy>();
  const assignmentBody = {
    employeeId: driverMe.user.id,
    driverAlias: "employee-1",
    stationAlias: "HOME-1",
    vehicleAlias: "vehicle-1",
    cardAlias: "card-employee-1",
    costCenter: "engineering",
    policyVersionId: policy.id,
    effectiveFrom: from,
    effectiveUntil: until,
  };
  const response = await admin.browser.request(`${root}/assignments`, assignmentBody);
  expect(response.status, await response.clone().text()).toBe(201);
  const assignment = await response.json<ReimbursementAssignment>();
  return { admin, finance, driver, org, root, policy, assignment, assignmentBody, financeTotpUri };
}
export async function draft(
  f: Awaited<ReturnType<typeof fixture>>,
  source = csv,
  extra: Record<string, unknown> = {},
) {
  const response = await f.admin.browser.request(`${f.root}/statements`, {
    assignmentId: f.assignment.id,
    ...period,
    csvBase64: btoa(source),
    mapping,
    revisionOf: null,
    ...extra,
  });
  expect([200, 201], await response.clone().text()).toContain(response.status);
  return response.json<ReimbursementStatement>();
}
export const approve = async (
  f: Awaited<ReturnType<typeof fixture>>,
  statement: ReimbursementStatement,
) =>
  f.finance.browser.request(`${f.root}/statements/${statement.id}/approve`, {
    snapshotSha256: statement.snapshotSha256,
    authenticatorCode: f.financeTotpUri ? await totp(f.financeTotpUri) : "",
  });
