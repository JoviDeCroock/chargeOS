import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { enrollmentFixture } from "./enrollment-fixture.mjs";
import { totp } from "../service/helpers.ts";
import { createNativeRecoveryEnrollment } from "../../service/node/recovery-enrollment.ts";
import { createNativeCommercialServer } from "../../service/node/http.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import {
  issueNativeRecoveryEnrollment,
  persistEnrollmentState,
  readEnrollmentState,
} from "../../service/node/recovery-enrollment-state.ts";
import { releaseNativeCommercialRecovery } from "../../service/node/recovery-release.ts";
import {
  RECOVERY_RELEASE_CONFIRMATION,
  sealNativeRelease,
} from "../../service/node/recovery-marker.ts";
import {
  businessFingerprint,
  checkpointNativeCommercial,
  createNativeRecoveryReviewTemplate,
  RECOVERY_REVIEW_CONFIRMATION,
  withNativeRecoveryCustody,
} from "../../service/node/recovery-review.ts";
import {
  exportCommercialRecovery,
  inspectCommercialRecovery,
  restoreCommercialRecovery,
} from "../../service/node/recovery.ts";
import { migrateNativeDatabase, readNativeMigrations } from "../../service/node/migrations.ts";
import { nativeConfiguration } from "../../service/node/configuration.ts";
import { fileURLToPath } from "node:url";
import { nativeHosting } from "../../service/configuration.ts";
import { deliverNativeAccountMail } from "../../service/node/mail.ts";
import { prepareNativePublicHandoff } from "../../service/node/public-handoff.ts";
import {
  PUBLIC_HANDOFF_CONFIRMATION,
  parseNativeHandoff,
  sealNativeHandoff,
} from "../../service/node/handoff-marker.ts";
import { handoffStateDigest } from "../../service/node/handoff-state.ts";
import { installNativePublicHandoff } from "../../service/node/public-install.ts";

let f,
  baseline,
  originalState,
  originalManifest,
  originalProof,
  uris = new Map(),
  oldCookies;
const password = "new synthetic release password 58!",
  root = "/service/api/recovery/enrollment";
class Browser {
  cookies = new Map();
  constructor(base) {
    this.base = base;
  }
  async request(path, body) {
    const response = await fetch(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: f.configuration.SERVICE_ORIGIN,
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";"),
        at = pair.indexOf("="),
        key = pair.slice(0, at),
        value = pair.slice(at + 1);
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return response;
  }
}
const release = () =>
  releaseNativeCommercialRecovery(
    f.configuration,
    f.data,
    f.manifest,
    RECOVERY_RELEASE_CONFIRMATION,
  );
const open = () => new NativeCommercialDatabase(f.data, { recoveryInspection: true });
beforeAll(async () => {
  f = await enrollmentFixture();
  const review = JSON.parse(await readFile(f.manifest, "utf8"));
  for (const org of review.organizations)
    for (const member of org.members)
      if (member.email === f.company.finance.email) member.role = "driver";
  await writeFile(f.manifest, JSON.stringify(review));
  const linksFile = join(f.directory, "links.json");
  await issueNativeRecoveryEnrollment(f.configuration, f.data, f.manifest, linksFile);
  const { links } = JSON.parse(await readFile(linksFile, "utf8"));
  await withNativeRecoveryCustody(f.data, async () => {
    const enrollment = await createNativeRecoveryEnrollment(f.data, f.manifest, f.configuration),
      server = createNativeCommercialServer(
        { ...f.configuration, SERVICE_DB: enrollment.database },
        enrollment.handler,
      );
    const port = await server.listen(0);
    try {
      for (const link of links) {
        const browser = new Browser(`http://127.0.0.1:${port}`),
          token = new URLSearchParams(new URL(link.url).hash.slice(1)).get("enroll");
        const started = await browser.request(`${root}/start`, { token, newPassword: password });
        expect(started.status, await started.clone().text()).toBe(200);
        const setupResponse = await browser.request(`${root}/authenticator`, { password });
        expect(setupResponse.status).toBe(200);
        const setup = await setupResponse.json();
        uris.set(link.email, setup.totpURI);
        const result = await browser.request(`${root}/verify`, { code: await totp(setup.totpURI) });
        expect(result.status, await result.clone().text()).toBe(200);
        oldCookies = new Map(browser.cookies);
      }
    } finally {
      await server.close();
      enrollment.close();
    }
  });
  baseline = join(f.directory, "baseline");
  await mkdir(baseline, { mode: 0o700 });
  const db = open();
  try {
    await db.snapshotTo(baseline);
  } finally {
    db.close();
  }
  originalState = await readFile(join(f.data, ".recovery-enrollment.json"));
  originalManifest = await readFile(f.manifest);
  originalProof = await readFile(f.proof);
}, 60000);
beforeEach(async () => {
  await copyFile(join(baseline, "commercial.sqlite"), join(f.data, "commercial.sqlite"));
  await writeFile(join(f.data, ".recovery-enrollment.json"), originalState);
  await writeFile(f.manifest, originalManifest, { mode: 0o600 });
  await writeFile(f.proof, originalProof);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (f) await rm(f.directory, { recursive: true, force: true });
});

it("atomically reopens the exact review with truthful operator attribution, then recognizes a committed retry", async () => {
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
  const result = await release();
  expect(result.status).toBe("released");
  const db = new NativeCommercialDatabase(f.data, {
    recoveryOrigin: f.configuration.SERVICE_ORIGIN,
    recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
  });
  try {
    const stored = JSON.parse(
      await db.prepare("SELECT receipt_json FROM _chargeos_native_release").first("receipt_json"),
    );
    expect(stored.receipt.afterBusinessSha256).toBe(
      await businessFingerprint(db, result.releaseId),
    );
    expect(stored.receipt.restoreId).toBe(result.restoreId);
    expect(
      await db
        .prepare("SELECT role FROM membership m JOIN user u ON u.id=m.user_id WHERE u.email=?")
        .bind(f.company.finance.email)
        .first("role"),
    ).toBe("driver");
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM membership m JOIN user u ON u.id=m.user_id WHERE u.email=?",
        )
        .bind(f.company.driver.email)
        .first("n"),
    ).toBe(0);
    const ends = (
      await db
        .prepare("SELECT created_by,recovery_release_id FROM reimbursement_assignment_end")
        .all()
    ).results;
    expect(ends).toContainEqual({ created_by: null, recovery_release_id: result.releaseId });
    expect(
      (
        await db
          .prepare(
            "SELECT actor_id,recovery_release_id FROM service_audit WHERE action='recovery.released'",
          )
          .all()
      ).results,
    ).toEqual([{ actor_id: null, recovery_release_id: result.releaseId }]);
    for (const table of ["session", "verification", "local_outbox", "rate_limit"])
      expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n")).toBe(0);
  } finally {
    db.close();
  }
  await rm(f.manifest);
  expect(await release()).toEqual({ ...result, status: "already-released" });
});

it("blocks incomplete or changed fresh credentials and changed current evidence without changing quarantine", async () => {
  const loaded = await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET);
  loaded.state.users[0].phase = "password-set";
  await persistEnrollmentState(
    f.data,
    f.configuration.SERVICE_AUTH_SECRET,
    loaded.state,
    loaded.serialized,
  );
  await expect(release()).rejects.toThrow(/fresh credential/);
  await writeFile(join(f.data, ".recovery-enrollment.json"), originalState);
  const db = open();
  try {
    await db
      .prepare("UPDATE account SET password='changed' WHERE user_id=?")
      .bind(loaded.state.users[0].userId)
      .run();
  } finally {
    db.close();
  }
  await expect(release()).rejects.toThrow(/credential|verification/);
  await copyFile(join(baseline, "commercial.sqlite"), join(f.data, "commercial.sqlite"));
  await writeFile(f.proof, "different current evidence");
  await expect(release()).rejects.toThrow(/Enrollment no longer matches/);
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
});

it("removes unexpected credentials for identities outside the keep-union", async () => {
  const db = open();
  try {
    const driver = await db
      .prepare("SELECT id FROM user WHERE email=?")
      .bind(f.company.driver.email)
      .first("id");
    await db
      .prepare(
        "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('extra',?,'credential',?,'unexpected',1,1)",
      )
      .bind(driver, driver)
      .run();
    await db
      .prepare("UPDATE user SET email_verified=1,two_factor_enabled=1 WHERE id=?")
      .bind(driver)
      .run();
  } finally {
    db.close();
  }
  await release();
  const live = open();
  try {
    expect(
      await live.prepare("SELECT count(*) AS n FROM account WHERE id='extra'").first("n"),
    ).toBe(0);
    expect(
      await live
        .prepare("SELECT email_verified,two_factor_enabled FROM user WHERE email=?")
        .bind(f.company.driver.email)
        .first(),
    ).toEqual({ email_verified: 0, two_factor_enabled: 0 });
  } finally {
    live.close();
  }
});

it("rolls back every roster/end/audit/receipt mutation if an in-transaction row guard fails, then retries", async () => {
  const db = open();
  const before = db.stateDigest();
  db.close();
  const checked = NativeCommercialDatabase.prototype.checkedBatch;
  vi.spyOn(NativeCommercialDatabase.prototype, "checkedBatch").mockImplementation(
    function (statements, changes, state) {
      return checked.call(this, statements, state ? [...changes.slice(0, -1), 2] : changes, state);
    },
  );
  await expect(release()).rejects.toThrow(/Atomic recovery mutation/);
  const unchanged = open();
  try {
    expect(unchanged.stateDigest()).toBe(before);
  } finally {
    unchanged.close();
  }
  vi.restoreAllMocks();
  expect((await release()).status).toBe("released");
});

it("refuses a finished release copy that exceeds the recovery size limit without mutating the source", async () => {
  const initial = open(),
    before = initial.stateDigest();
  initial.close();
  const checked = NativeCommercialDatabase.prototype.checkedBatch;
  vi.spyOn(NativeCommercialDatabase.prototype, "checkedBatch").mockImplementation(
    function (statements, changes, state) {
      const result = checked.call(this, statements, changes, state);
      if (
        this.path !== join(f.data, "commercial.sqlite") &&
        statements.some((s) => s.query === "INSERT INTO _chargeos_native_release VALUES(1,?)")
      ) {
        // Allocate and free real SQLite pages without changing logical rows or
        // the exact finished schema. Only the final size guard can catch this.
        this.execute("CREATE TABLE _oversize(payload BLOB)", []);
        this.execute("INSERT INTO _oversize VALUES(zeroblob(67108864))", []);
        this.execute("DROP TABLE _oversize", []);
      }
      return result;
    },
  );
  await expect(release()).rejects.toThrow(/size boundary/);
  const unchanged = open();
  try {
    expect(unchanged.stateDigest()).toBe(before);
  } finally {
    unchanged.close();
  }
});

it("refuses state changes during preflight and holds custody against an active enrollment process", async () => {
  await withNativeRecoveryCustody(f.data, async () => {
    await expect(release()).rejects.toThrow(/EEXIST/);
  });
  const snapshot = NativeCommercialDatabase.prototype.snapshotTo;
  vi.spyOn(NativeCommercialDatabase.prototype, "snapshotTo").mockImplementation(
    async function (directory) {
      const path = await snapshot.call(this, directory);
      if (this.path === join(f.data, "commercial.sqlite"))
        await this.prepare("UPDATE user SET updated_at=updated_at+1").run();
      return path;
    },
  );
  await expect(release()).rejects.toThrow(/state changed/);
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
});

it("rereads current evidence and authenticated enrollment after asynchronous preflight", async () => {
  const initial = open(),
    before = initial.stateDigest();
  initial.close();
  const snapshot = NativeCommercialDatabase.prototype.snapshotTo;
  vi.spyOn(NativeCommercialDatabase.prototype, "snapshotTo").mockImplementation(
    async function (directory) {
      const path = await snapshot.call(this, directory);
      if (this.path === join(f.data, "commercial.sqlite"))
        await writeFile(f.proof, "evidence changed during preflight");
      return path;
    },
  );
  await expect(release()).rejects.toThrow(/review or enrollment changed/);
  const unchanged = open();
  try {
    expect(unchanged.stateDigest()).toBe(before);
  } finally {
    unchanged.close();
  }
});

it("requires authentic same-restore receipts and preserves startup after review expiry and legitimate business changes", async () => {
  await release();
  expect(() => new NativeCommercialDatabase(f.data, { recoverySecret: "wrong secret" })).toThrow(
    /startup verification/,
  );
  const db = open();
  let sealed;
  try {
    sealed = await db
      .prepare("SELECT receipt_json FROM _chargeos_native_release")
      .first("receipt_json");
    const value = JSON.parse(sealed);
    value.receipt.restoreId = "another restore";
    await db
      .prepare("UPDATE _chargeos_native_release SET receipt_json=?")
      .bind(sealNativeRelease(value.receipt, f.configuration.SERVICE_AUTH_SECRET))
      .run();
  } finally {
    db.close();
  }
  expect(
    () =>
      new NativeCommercialDatabase(f.data, {
        recoveryOrigin: f.configuration.SERVICE_ORIGIN,
        recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
      }),
  ).toThrow(/startup verification/);
  const change = open();
  try {
    await change.prepare("UPDATE _chargeos_native_release SET receipt_json=?").bind(sealed).run();
    await change.prepare("UPDATE organization SET name='Changed after release'").run();
    await change.prepare("UPDATE account SET updated_at=updated_at+1").run();
  } finally {
    change.close();
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 3 * 86400000);
  try {
    const restarted = new NativeCommercialDatabase(f.data, {
      recoveryOrigin: f.configuration.SERVICE_ORIGIN,
      recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    });
    restarted.close();
  } finally {
    vi.useRealTimers();
  }
  const erase = open();
  try {
    await erase.prepare("DELETE FROM _chargeos_native_release").run();
  } finally {
    erase.close();
  }
  expect(
    () =>
      new NativeCommercialDatabase(f.data, {
        recoveryOrigin: f.configuration.SERVICE_ORIGIN,
        recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
      }),
  ).toThrow(/startup verification/);
});

it("uses normal fresh-password MFA after reopening and rejects enrollment cookies", async () => {
  await release();
  const db = new NativeCommercialDatabase(f.data, {
      recoveryOrigin: f.configuration.SERVICE_ORIGIN,
      recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    }),
    server = createNativeCommercialServer({ ...f.configuration, SERVICE_DB: db });
  const port = await server.listen(0),
    browser = new Browser(`http://127.0.0.1:${port}`);
  try {
    browser.cookies = new Map(oldCookies);
    expect((await browser.request("/service/api/v1/me")).status).toBe(401);
    const login = await browser.request("/service/api/auth/sign-in/email", {
      email: f.company.admin.email,
      password,
    });
    expect(login.status, await login.clone().text()).toBe(200);
    expect((await login.json()).twoFactorRedirect).toBe(true);
    expect((await browser.request("/service/api/v1/me")).status).toBe(401);
    const verified = await browser.request("/service/api/auth/two-factor/verify-totp", {
      code: await totp(uris.get(f.company.admin.email)),
      trustDevice: false,
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect((await browser.request("/service/api/v1/me")).status).toBe(200);
    expect(
      (
        await browser.request("/service/api/v1/organizations", {
          name: "A new organization after recovery",
        })
      ).status,
    ).toBe(201);
    const audit = await browser.request(`/service/api/v1/organizations/${f.company.org.id}/audit`);
    expect(audit.status).toBe(200);
    expect((await audit.json()).events).toContainEqual(
      expect.objectContaining({
        action: "recovery.released",
        actorId: null,
        recoveryReleaseId: expect.any(String),
      }),
    );
  } finally {
    await server.close();
    db.close();
  }
});
it("requires an explicit exact reviewed origin for released startup, direct HTTP adapters and committed release retries", async () => {
  await release();
  const secret = f.configuration.SERVICE_AUTH_SECRET;
  expect(() => new NativeCommercialDatabase(f.data, { recoverySecret: secret })).toThrow(
    /startup verification/,
  );
  for (const origin of ["http://127.0.0.1:5174", "https://accounts.example.test"]) {
    const configuration = origin.startsWith("https:")
      ? {
          ...f.configuration,
          SERVICE_MODE: "production",
          SERVICE_ORIGIN: origin,
          SERVICE_DELIVERY: "smtp",
          SERVICE_SIGNUP_DOMAINS: "example.test",
          [nativeHosting]: true,
        }
      : { ...f.configuration, SERVICE_ORIGIN: origin };
    expect(
      () =>
        new NativeCommercialDatabase(f.data, { recoverySecret: secret, recoveryOrigin: origin }),
    ).toThrow(/startup verification/);
    // Inspection remains possible, but an inspection connection cannot become
    // a live HTTP capability for a different deployment origin.
    const inspected = open();
    try {
      expect(inspected.recoveryState(undefined, true)).toBe("released");
      expect(() =>
        createNativeCommercialServer({ ...configuration, SERVICE_DB: inspected }),
      ).toThrow(/origin/);
    } finally {
      inspected.close();
    }
  }
  await expect(
    releaseNativeCommercialRecovery(
      { ...f.configuration, SERVICE_ORIGIN: "http://127.0.0.1:5174" },
      f.data,
      f.manifest,
      RECOVERY_RELEASE_CONFIRMATION,
    ),
  ).rejects.toThrow(/origin/);
});
it("does not export, checkpoint or deliver mail under an unreviewed public origin", async () => {
  await release();
  const configuration = {
    ...f.configuration,
    SERVICE_MODE: "production",
    SERVICE_ORIGIN: "https://accounts.example.test",
    SERVICE_DELIVERY: "smtp",
    SERVICE_SIGNUP_DOMAINS: "example.test",
    [nativeHosting]: true,
  };
  await expect(
    exportCommercialRecovery(
      configuration,
      f.data,
      join(f.directory, "foreign-origin.bundle"),
      "synthetic foreign origin passphrase!",
    ),
  ).rejects.toThrow(/startup verification/);
  await expect(
    checkpointNativeCommercial(
      configuration,
      f.data,
      join(f.directory, "foreign-origin-checkpoint.json"),
    ),
  ).rejects.toThrow(/startup verification/);
  await expect(
    deliverNativeAccountMail(configuration, f.data, {
      host: "smtp.example.test",
      port: 587,
      security: "starttls",
      username: "synthetic",
      password: "synthetic",
      sender: "accounts@example.test",
    }),
  ).rejects.toThrow(/startup verification/);
});

it("backs up a public handoff with real reimbursement history and restores it into a new quarantined epoch before a fresh release", async () => {
  const released = await release(),
    bundle = join(f.directory, "released.bundle"),
    checkpoint = join(f.directory, "released-checkpoint.json"),
    target = join(f.directory, "second-restore"),
    phrase = "a second synthetic backup passphrase!";
  const capsule = packagePath();
  await handoff(capsule);
  const publicConfig = {
    ...f.configuration,
    SERVICE_MODE: "production",
    SERVICE_ORIGIN: publicOrigin,
    SERVICE_DELIVERY: "smtp",
    SERVICE_SIGNUP_DOMAINS: "example.test",
    [nativeHosting]: true,
  };
  await exportCommercialRecovery(publicConfig, join(capsule, "data"), bundle, phrase);
  await checkpointNativeCommercial(publicConfig, join(capsule, "data"), checkpoint);
  expect((await inspectCommercialRecovery(bundle, phrase)).organizations).toBe(1);
  const restored = await restoreCommercialRecovery(bundle, target, phrase);
  expect(restored.restoreId).not.toBe(released.restoreId);
  const data = join(target, "data"),
    db = new NativeCommercialDatabase(data, { recoveryInspection: true });
  try {
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='_chargeos_native_release'")
        .first("n"),
    ).toBe(0);
    expect(
      await db
        .prepare("SELECT release_id FROM _chargeos_native_release_history")
        .first("release_id"),
    ).toBe(released.releaseId);
    expect(
      await db.prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff'").first(),
    ).toBeNull();
    expect(
      await db.prepare("SELECT count(*) AS n FROM _chargeos_native_handoff_history").first("n"),
    ).toBe(1);
    for (const table of ["account", "session", "two_factor", "verification", "local_outbox"])
      expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n")).toBe(0);
  } finally {
    db.close();
  }
  const fresh = nativeConfiguration({
    SERVICE_NATIVE_CONFIG: join(target, "service.vars"),
    SERVICE_NATIVE_DATA: data,
  }).configuration;
  expect(fresh.SERVICE_AUTH_SECRET).not.toBe(f.configuration.SERVICE_AUTH_SECRET);
  expect(
    () =>
      new NativeCommercialDatabase(data, {
        recoveryOrigin: fresh.SERVICE_ORIGIN,
        recoverySecret: fresh.SERVICE_AUTH_SECRET,
      }),
  ).toThrow(/quarantined/);
  await expect(restoreCommercialRecovery(bundle, target, phrase)).rejects.toThrow(/EEXIST/);
  const manifest = join(f.directory, "second-review.json");
  await createNativeRecoveryReviewTemplate(data, manifest);
  const review = JSON.parse(await readFile(manifest, "utf8"));
  Object.assign(review, {
    confirmation: RECOVERY_REVIEW_CONFIRMATION,
    reviewedThrough: new Date().toISOString(),
    sourceRetirementEvidenceFile: f.proof,
    financialCheckpointFile: checkpoint,
  });
  for (const org of review.organizations) {
    org.rosterEvidenceFile = f.proof;
    org.financialEvidenceFile = f.proof;
    for (const member of org.members) {
      member.decision = "keep";
      member.identityEvidenceFile = f.proof;
    }
  }
  await writeFile(manifest, JSON.stringify(review));
  const linksFile = join(f.directory, "second-links.json");
  await issueNativeRecoveryEnrollment(fresh, data, manifest, linksFile);
  const links = JSON.parse(await readFile(linksFile, "utf8")).links;
  await withNativeRecoveryCustody(data, async () => {
    const enrollment = await createNativeRecoveryEnrollment(data, manifest, fresh),
      http = createNativeCommercialServer(
        { ...fresh, SERVICE_DB: enrollment.database },
        enrollment.handler,
      ),
      port = await http.listen(0);
    try {
      for (const link of links) {
        const browser = new Browser(`http://127.0.0.1:${port}`),
          token = new URLSearchParams(new URL(link.url).hash.slice(1)).get("enroll");
        expect(
          (await browser.request(`${root}/start`, { token, newPassword: password })).status,
        ).toBe(200);
        const setup = await (await browser.request(`${root}/authenticator`, { password })).json();
        expect(
          (await browser.request(`${root}/verify`, { code: await totp(setup.totpURI) })).status,
        ).toBe(200);
      }
    } finally {
      await http.close();
      enrollment.close();
    }
  });
  const second = await releaseNativeCommercialRecovery(
    fresh,
    data,
    manifest,
    RECOVERY_RELEASE_CONFIRMATION,
  );
  const live = new NativeCommercialDatabase(data, {
    recoveryOrigin: fresh.SERVICE_ORIGIN,
    recoverySecret: fresh.SERVICE_AUTH_SECRET,
  });
  try {
    expect(
      await live.prepare("SELECT count(*) AS n FROM _chargeos_native_release_history").first("n"),
    ).toBe(2);
    const current = JSON.parse(
      await live.prepare("SELECT receipt_json FROM _chargeos_native_release").first("receipt_json"),
    );
    expect(current.receipt.afterBusinessSha256).toBe(
      await businessFingerprint(live, second.releaseId),
    );
  } finally {
    live.close();
  }
  const nextCapsule = packagePath(),
    nextOrigin = "https://replacement.example.test";
  await prepareNativePublicHandoff(
    fresh,
    data,
    manifest,
    nextCapsule,
    nextOrigin,
    PUBLIC_HANDOFF_CONFIRMATION,
  );
  const nextData = packagePath();
  await mkdir(nextData, { mode: 0o700 });
  await installNativePublicHandoff(
    await readFile(join(nextCapsule, "data/commercial.sqlite")),
    fresh.SERVICE_AUTH_SECRET,
    await readFile(join(nextCapsule, "install.json"), "utf8"),
    nextData,
    nextOrigin,
  );
  const installed = new NativeCommercialDatabase(nextData, {
    recoverySecret: fresh.SERVICE_AUTH_SECRET,
    recoveryOrigin: nextOrigin,
  });
  try {
    expect(
      await installed
        .prepare("SELECT count(*) AS n FROM _chargeos_native_handoff_history")
        .first("n"),
    ).toBe(2);
    const old = JSON.parse(
      await installed
        .prepare("SELECT receipt_json FROM _chargeos_native_release_history WHERE release_id=?")
        .bind(released.releaseId)
        .first("receipt_json"),
    );
    old.receipt.origin = "http://127.0.0.1:1234";
    await installed
      .prepare("UPDATE _chargeos_native_release_history SET receipt_json=? WHERE release_id=?")
      .bind(JSON.stringify(old), released.releaseId)
      .run();
  } finally {
    installed.close();
  }
  expect(
    () =>
      new NativeCommercialDatabase(nextData, {
        recoveryOrigin: nextOrigin,
        recoverySecret: fresh.SERVICE_AUTH_SECRET,
      }),
  ).toThrow(/startup verification/);
});

it("refuses partial recovery markers and preserves lifecycle custody even after a valid release commit", async () => {
  await release();
  const saved = await mkdtemp(join(tmpdir(), "chargeos-release-markers-"));
  const initial = open();
  try {
    await initial.snapshotTo(saved);
  } finally {
    initial.close();
  }
  try {
    await withNativeRecoveryCustody(f.data, async () => {
      expect(
        () =>
          new NativeCommercialDatabase(f.data, {
            recoveryOrigin: f.configuration.SERVICE_ORIGIN,
            recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
          }),
      ).toThrow(/quarantined/);
    });
    for (const statements of [
      ["DELETE FROM _chargeos_native_recovery"],
      ["DROP TABLE _chargeos_native_recovery"],
      ["DROP TABLE _chargeos_native_recovery", "DROP TABLE _chargeos_native_release"],
      ["DROP TABLE _chargeos_native_release_history"],
      ["DROP TABLE _chargeos_native_release"],
      ["DELETE FROM _chargeos_native_release"],
    ]) {
      await copyFile(join(saved, "commercial.sqlite"), join(f.data, "commercial.sqlite"));
      const db = open();
      try {
        await db.batch(statements.map((sql) => db.prepare(sql)));
      } finally {
        db.close();
      }
      expect(
        () =>
          new NativeCommercialDatabase(f.data, {
            recoveryOrigin: f.configuration.SERVICE_ORIGIN,
            recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
          }),
      ).toThrow(/startup verification|quarantined/);
    }
  } finally {
    await rm(saved, { recursive: true, force: true });
  }
});

const publicOrigin = "https://accounts.example.test";
const packagePath = () => join(f.directory, `public-${crypto.randomUUID()}`);
const handoff = (target, hooks = {}) =>
  prepareNativePublicHandoff(
    f.configuration,
    f.data,
    f.manifest,
    target,
    publicOrigin,
    PUBLIC_HANDOFF_CONFIRMATION,
    hooks,
  );
function publicOpen(target) {
  return new NativeCommercialDatabase(join(target, "data"), {
    recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    recoveryOrigin: publicOrigin,
  });
}
it("prepares a fresh HTTPS capsule only after retiring the exact source and recognizes its unchanged retry", async () => {
  await release();
  const target = packagePath();
  const source = open();
  let before;
  try {
    before = await businessFingerprint(source);
    await source
      .prepare(
        "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES('handoff-private','handoff-private',?,9999999999999,1,1)",
      )
      .bind("synthetic-private-handoff-link-must-not-survive-vacuum")
      .run();
  } finally {
    source.close();
  }
  const result = await handoff(target);
  expect(result).toMatchObject({
    status: "prepared",
    sourceState: "retired",
    origin: publicOrigin,
  });
  expect(
    () =>
      new NativeCommercialDatabase(f.data, {
        recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
        recoveryOrigin: f.configuration.SERVICE_ORIGIN,
      }),
  ).toThrow();
  const retired = open();
  try {
    expect(
      retired.recoveryState(
        f.configuration.SERVICE_AUTH_SECRET,
        false,
        f.configuration.SERVICE_ORIGIN,
      ),
    ).toBe("retired");
    expect(
      await retired.prepare("SELECT count(*) AS n FROM _chargeos_native_release").first("n"),
    ).toBe(0);
    expect(await handoffStateDigest(retired, result.handoffId)).toBe(
      parseNativeHandoff(
        await readFile(join(target, "intent.json"), "utf8"),
        f.configuration.SERVICE_AUTH_SECRET,
      ).sourceStateSha256,
    );
  } finally {
    retired.close();
  }
  const published = publicOpen(target);
  try {
    expect(published.recoveryState(f.configuration.SERVICE_AUTH_SECRET, false, publicOrigin)).toBe(
      "released",
    );
    expect(await published.prepare("SELECT count(*) AS n FROM verification").first("n")).toBe(0);
    const body = await published
      .prepare("SELECT receipt_json FROM _chargeos_native_handoff")
      .first("receipt_json");
    const h = parseNativeHandoff(body, f.configuration.SERVICE_AUTH_SECRET);
    expect(h.role).toBe("public-install");
    expect(parseNativeHandoff(h.sourceRetirement, f.configuration.SERVICE_AUTH_SECRET).role).toBe(
      "source-retired",
    );
    expect(await businessFingerprint(published)).not.toBe(before); // retained handoff history is new audit evidence
  } finally {
    published.close();
  }
  expect(
    (await readFile(join(target, "data/commercial.sqlite"))).includes(
      Buffer.from("synthetic-private-handoff-link-must-not-survive-vacuum"),
    ),
  ).toBe(false);
  for (const name of ["auth.key", "install.json", "READY"])
    expect((await lstat(join(target, name))).mode & 0o777).toBe(0o600);
  expect(await handoff(target)).toEqual(result);
  await expect(handoff(packagePath())).rejects.toThrow(/another handoff/);
});

it("refuses source, review and capsule build-context paths before fencing a released source", async () => {
  await release();
  const checkout = join(f.directory, "synthetic-checkout");
  await mkdir(checkout, { mode: 0o700 });
  for (const name of ["Dockerfile.company", "compose.company.json", "package.json"])
    await writeFile(join(checkout, name), "synthetic build root");
  const insideReview = join(checkout, "review.json");
  await copyFile(f.manifest, insideReview);
  for (const [data, manifest, target] of [
    [checkout, f.manifest, packagePath()],
    [f.data, insideReview, packagePath()],
    [f.data, f.manifest, join(checkout, "new-capsule")],
  ]) {
    await expect(
      prepareNativePublicHandoff(
        f.configuration,
        data,
        manifest,
        target,
        publicOrigin,
        PUBLIC_HANDOFF_CONFIRMATION,
      ),
    ).rejects.toThrow(/outside.*build context/);
    await expect(lstat(target)).rejects.toThrow();
    const stillLive = new NativeCommercialDatabase(f.data, {
      recoveryOrigin: f.configuration.SERVICE_ORIGIN,
      recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    });
    stillLive.close();
  }
});
it.each([
  "prepared",
  "before-fence",
  "after-fence",
  "before-public-authority",
  "before-package-copy",
  "before-ready",
  "after-key-link",
  "after-manifest-link",
  "after-ready-link",
])("keeps a single resumable package across an interruption at %s", async (stage) => {
  await release();
  const target = packagePath();
  await expect(
    handoff(target, {
      at: async (current) => {
        if (current === stage) throw new Error("synthetic interruption");
      },
    }),
  ).rejects.toThrow(/synthetic interruption/);
  const source = open();
  try {
    expect(
      source.recoveryState(
        f.configuration.SERVICE_AUTH_SECRET,
        false,
        f.configuration.SERVICE_ORIGIN,
      ),
    ).toBe(["prepared", "before-fence"].includes(stage) ? "released" : "retired");
  } finally {
    source.close();
  }
  const intent = await readFile(join(target, "intent.json"));
  const result = await handoff(target);
  expect(result.sourceState).toBe("retired");
  expect(await readFile(join(target, "intent.json"))).toEqual(intent);
  const ready = publicOpen(target);
  ready.close();
});
it("rejects changed current evidence, credentials, expiry, occupied targets and a replacement package inode before fencing", async () => {
  await release();
  await writeFile(f.proof, "changed operator evidence");
  await expect(handoff(packagePath())).rejects.toThrow(/review inputs|evidence/);
  await writeFile(f.proof, originalProof);
  const occupied = packagePath();
  await mkdir(occupied, { mode: 0o700 });
  await writeFile(join(occupied, "sentinel"), "untouched", { mode: 0o600 });
  await expect(handoff(occupied)).rejects.toThrow();
  expect(await readFile(join(occupied, "sentinel"), "utf8")).toBe("untouched");
  const target = packagePath();
  await expect(
    handoff(target, {
      at: async (stage) => {
        if (stage === "prepared") throw new Error("pause");
      },
    }),
  ).rejects.toThrow(/pause/);
  await rename(target, target + "-retained");
  await mkdir(target, { mode: 0o700 });
  await copyFile(join(target + "-retained", "intent.json"), join(target, "intent.json"));
  await expect(handoff(target)).rejects.toThrow(/identity changed/);
  const source = open();
  try {
    expect(
      source.recoveryState(
        f.configuration.SERVICE_AUTH_SECRET,
        false,
        f.configuration.SERVICE_ORIGIN,
      ),
    ).toBe("released");
  } finally {
    source.close();
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 86400000);
  try {
    await expect(handoff(packagePath())).rejects.toThrow(/fresh|unexpired/);
  } finally {
    vi.useRealTimers();
  }
});
it("bounds the actual finished public preflight including handoff authority before retiring the source", async () => {
  await release();
  const original = NativeCommercialDatabase.prototype.checkedBatch;
  let injected = false;
  vi.spyOn(NativeCommercialDatabase.prototype, "checkedBatch").mockImplementation(function (
    ...args
  ) {
    const result = original.apply(this, args);
    if (!injected && this.path.includes("chargeos-public-preflight-")) {
      injected = true;
      void this.prepare(
        "UPDATE user SET image=hex(zeroblob(34*1024*1024)) WHERE id=(SELECT id FROM user LIMIT 1)",
      ).run();
    }
    return result;
  });
  await expect(handoff(packagePath())).rejects.toThrow(/size boundary/);
  expect(injected).toBe(true);
  const source = new NativeCommercialDatabase(f.data, {
    recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    recoveryOrigin: f.configuration.SERVICE_ORIGIN,
  });
  try {
    expect(
      source.recoveryState(
        f.configuration.SERVICE_AUTH_SECRET,
        false,
        f.configuration.SERVICE_ORIGIN,
      ),
    ).toBe("released");
    expect(
      await source
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff'")
        .first(),
    ).toBeNull();
  } finally {
    source.close();
  }
});
it("retains an incomplete private output orphan while publishing a complete readiness file on retry", async () => {
  await release();
  const target = packagePath();
  await expect(
    handoff(target, {
      at: async (stage) => {
        if (stage === "before-ready") throw new Error("pause");
      },
    }),
  ).rejects.toThrow(/pause/);
  const orphan = join(target, ".publication", `READY-${crypto.randomUUID()}`);
  await writeFile(orphan, "partial private output", { mode: 0o600, flag: "wx" });
  expect((await handoff(target)).sourceState).toBe("retired");
  expect(await readFile(orphan, "utf8")).toBe("partial private output");
  expect((await lstat(join(target, "READY"))).nlink).toBe(1);
});
it("refuses an incomplete installation before creating an ordinary database or opening a direct public HTTP adapter", async () => {
  const data = packagePath();
  await mkdir(data, { mode: 0o700 });
  await mkdir(join(data, ".public-install"), { mode: 0o700 });
  expect(
    () =>
      new NativeCommercialDatabase(data, {
        recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
        recoveryOrigin: publicOrigin,
      }),
  ).toThrow(/incomplete/);
  await expect(lstat(join(data, "commercial.sqlite"))).rejects.toThrow();
  const inspection = new NativeCommercialDatabase(data, { recoveryInspection: true });
  try {
    expect(() =>
      createNativeCommercialServer({
        ...f.configuration,
        SERVICE_MODE: "production",
        SERVICE_ORIGIN: publicOrigin,
        SERVICE_DELIVERY: "smtp",
        SERVICE_SIGNUP_DOMAINS: "example.test",
        [nativeHosting]: true,
        SERVICE_DB: inspection,
      }),
    ).toThrow(/quarantined/);
  } finally {
    inspection.close();
  }
});
it("does not resurrect a retired source after partial marker/history deletion or restored active-release rows", async () => {
  await release();
  const target = packagePath();
  await handoff(target);
  const saved = packagePath();
  await mkdir(saved, { mode: 0o700 });
  const source = open();
  try {
    await source.snapshotTo(saved);
  } finally {
    source.close();
  }
  for (const sql of [
    "DELETE FROM _chargeos_native_handoff",
    "DROP TABLE _chargeos_native_handoff",
    "DELETE FROM _chargeos_native_handoff_history",
    "DROP TABLE _chargeos_native_handoff_history",
    "DROP TABLE _chargeos_native_release_history",
    "INSERT INTO _chargeos_native_release SELECT 1,receipt_json FROM _chargeos_native_release_history ORDER BY release_id LIMIT 1",
  ]) {
    await copyFile(join(saved, "commercial.sqlite"), join(f.data, "commercial.sqlite"));
    const edited = open();
    try {
      await edited.prepare(sql).run();
    } finally {
      edited.close();
    }
    expect(
      () =>
        new NativeCommercialDatabase(f.data, {
          recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
          recoveryOrigin: f.configuration.SERVICE_ORIGIN,
        }),
    ).toThrow();
  }
});
it("binds active public authority to its exact embedded retirement, review, history and HTTPS origin", async () => {
  await release();
  const target = packagePath();
  await handoff(target);
  const data = join(target, "data"),
    saved = packagePath();
  await mkdir(saved, { mode: 0o700 });
  const db = publicOpen(target);
  let serialized;
  try {
    serialized = await db
      .prepare("SELECT receipt_json FROM _chargeos_native_handoff")
      .first("receipt_json");
    await db.snapshotTo(saved);
  } finally {
    db.close();
  }
  for (const origin of [f.configuration.SERVICE_ORIGIN, "https://other.example.test"])
    expect(
      () =>
        new NativeCommercialDatabase(data, {
          recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
          recoveryOrigin: origin,
        }),
    ).toThrow();
  for (const sql of [
    "DELETE FROM _chargeos_native_handoff",
    "DROP TABLE _chargeos_native_handoff",
    "DELETE FROM _chargeos_native_handoff_history",
    "DROP TABLE _chargeos_native_handoff_history",
    "DELETE FROM _chargeos_native_release",
    "DROP TABLE _chargeos_native_release_history",
  ]) {
    await copyFile(join(saved, "commercial.sqlite"), join(data, "commercial.sqlite"));
    const edited = new NativeCommercialDatabase(data, { recoveryInspection: true });
    try {
      await edited.prepare(sql).run();
    } finally {
      edited.close();
    }
    expect(() => publicOpen(target)).toThrow();
  }
  await copyFile(join(saved, "commercial.sqlite"), join(data, "commercial.sqlite"));
  const parsed = JSON.parse(serialized).receipt;
  const source = JSON.parse(parsed.sourceRetirement).receipt;
  source.targetOrigin = "https://other.example.test";
  parsed.sourceRetirement = sealNativeHandoff(source, f.configuration.SERVICE_AUTH_SECRET);
  const changed = sealNativeHandoff(parsed, f.configuration.SERVICE_AUTH_SECRET);
  const edited = new NativeCommercialDatabase(data, { recoveryInspection: true });
  try {
    await edited.prepare("UPDATE _chargeos_native_handoff SET receipt_json=?").bind(changed).run();
    await edited
      .prepare("UPDATE _chargeos_native_handoff_history SET receipt_json=?")
      .bind(changed)
      .run();
  } finally {
    edited.close();
  }
  expect(() => publicOpen(target)).toThrow();
});
it("keeps old version-one releases locally readable but refuses a silent public handoff upgrade", async () => {
  await release();
  const db = open();
  try {
    const raw = await db
        .prepare("SELECT receipt_json FROM _chargeos_native_release")
        .first("receipt_json"),
      r = JSON.parse(raw).receipt;
    r.schemaVersion = 1;
    delete r.handoffHistorySha256;
    const sealed = sealNativeRelease(r, f.configuration.SERVICE_AUTH_SECRET);
    await db.prepare("UPDATE _chargeos_native_release SET receipt_json=?").bind(sealed).run();
    await db
      .prepare("UPDATE _chargeos_native_release_history SET receipt_json=? WHERE release_id=?")
      .bind(sealed, r.releaseId)
      .run();
  } finally {
    db.close();
  }
  const local = new NativeCommercialDatabase(f.data, {
    recoverySecret: f.configuration.SERVICE_AUTH_SECRET,
    recoveryOrigin: f.configuration.SERVICE_ORIGIN,
  });
  local.close();
  await expect(handoff(packagePath())).rejects.toThrow(/versioned history binding/);
});

async function preparedCapsule() {
  await release();
  const target = packagePath();
  await handoff(target);
  return {
    target,
    bytes: await readFile(join(target, "data/commercial.sqlite")),
    secret: await readFile(join(target, "auth.key"), "utf8"),
    manifest: await readFile(join(target, "install.json"), "utf8"),
  };
}
it("installs only the authenticated capsule in a fresh volume and recognizes its own later legitimate state without overwriting", async () => {
  const capsule = await preparedCapsule(),
    data = packagePath();
  await mkdir(data, { mode: 0o700 });
  expect(
    await installNativePublicHandoff(
      capsule.bytes,
      capsule.secret,
      capsule.manifest,
      data,
      publicOrigin,
    ),
  ).toMatchObject({ status: "installed", origin: publicOrigin });
  const before = await lstat(join(data, "commercial.sqlite"));
  const db = new NativeCommercialDatabase(data, {
    recoverySecret: capsule.secret,
    recoveryOrigin: publicOrigin,
  });
  try {
    await db.prepare("UPDATE organization SET name='Legitimate later company name'").run();
  } finally {
    db.close();
  }
  expect(
    await installNativePublicHandoff(
      capsule.bytes,
      capsule.secret,
      capsule.manifest,
      data,
      publicOrigin,
    ),
  ).toMatchObject({ status: "already-installed" });
  expect((await lstat(join(data, "commercial.sqlite"))).ino).toBe(before.ino);
  const current = new NativeCommercialDatabase(data, { recoveryInspection: true, readOnly: true });
  try {
    expect(await current.prepare("SELECT name FROM organization").first("name")).toBe(
      "Legitimate later company name",
    );
    await expect(
      current.prepare("UPDATE organization SET name='must refuse'").run(),
    ).rejects.toThrow();
  } finally {
    current.close();
  }
  const changed = Buffer.from(capsule.bytes);
  changed[changed.length - 1] ^= 1;
  await expect(
    installNativePublicHandoff(changed, capsule.secret, capsule.manifest, data, publicOrigin),
  ).rejects.toThrow();
  await expect(
    installNativePublicHandoff(capsule.bytes, "z".repeat(64), capsule.manifest, data, publicOrigin),
  ).rejects.toThrow();
  await expect(
    installNativePublicHandoff(
      capsule.bytes,
      capsule.secret,
      capsule.manifest,
      data,
      "https://other.example.test",
    ),
  ).rejects.toThrow();
  const occupied = packagePath();
  await mkdir(occupied, { mode: 0o700 });
  const old = new NativeCommercialDatabase(occupied);
  old.close();
  const original = await readFile(join(occupied, "commercial.sqlite"));
  await expect(
    installNativePublicHandoff(
      capsule.bytes,
      capsule.secret,
      capsule.manifest,
      occupied,
      publicOrigin,
    ),
  ).rejects.toThrow();
  expect(await readFile(join(occupied, "commercial.sqlite"))).toEqual(original);
});
it.each(["before-link", "after-link", "after-unlink"])(
  "finishes only its exact staged publication after interruption at %s",
  async (stage) => {
    const capsule = await preparedCapsule(),
      data = packagePath();
    await mkdir(data, { mode: 0o700 });
    await expect(
      installNativePublicHandoff(
        capsule.bytes,
        capsule.secret,
        capsule.manifest,
        data,
        publicOrigin,
        {
          at: async (current) => {
            if (current === stage) throw new Error("synthetic publication interruption");
          },
        },
      ),
    ).rejects.toThrow(/synthetic publication interruption/);
    if (stage !== "after-unlink")
      expect(
        () =>
          new NativeCommercialDatabase(data, {
            recoverySecret: capsule.secret,
            recoveryOrigin: publicOrigin,
          }),
      ).toThrow();
    if (stage === "after-link") {
      const a = await lstat(join(data, "commercial.sqlite")),
        b = await lstat(join(data, ".public-install/commercial.sqlite"));
      expect(a.ino).toBe(b.ino);
      expect(a.nlink).toBe(2);
    }
    expect(
      await installNativePublicHandoff(
        capsule.bytes,
        capsule.secret,
        capsule.manifest,
        data,
        publicOrigin,
      ),
    ).toMatchObject({ status: stage === "after-unlink" ? "already-installed" : "installed" });
    expect((await lstat(join(data, "commercial.sqlite"))).nlink).toBe(1);
    const running = new NativeCommercialDatabase(data, {
      recoverySecret: capsule.secret,
      recoveryOrigin: publicOrigin,
    });
    running.close();
  },
);
it("does not unlink an interrupted publication with changed private journal authority", async () => {
  const capsule = await preparedCapsule(),
    data = packagePath();
  await mkdir(data, { mode: 0o700 });
  await expect(
    installNativePublicHandoff(
      capsule.bytes,
      capsule.secret,
      capsule.manifest,
      data,
      publicOrigin,
      {
        at: async (stage) => {
          if (stage === "after-link") throw new Error("pause");
        },
      },
    ),
  ).rejects.toThrow(/pause/);
  const journal = join(data, ".public-install/journal.json"),
    value = JSON.parse(await readFile(journal, "utf8"));
  value.mac = "0".repeat(64);
  await writeFile(journal, JSON.stringify(value));
  await expect(
    installNativePublicHandoff(capsule.bytes, capsule.secret, capsule.manifest, data, publicOrigin),
  ).rejects.toThrow();
  const a = await lstat(join(data, "commercial.sqlite")),
    b = await lstat(join(data, ".public-install/commercial.sqlite"));
  expect(a.ino).toBe(b.ino);
  expect(a.nlink).toBe(2);
});

it("upgrades existing user-attributed audit and eligibility records without loss and enforces exactly one actor source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-actor-upgrade-")),
    db = new NativeCommercialDatabase(directory),
    migrations = readNativeMigrations(
      fileURLToPath(new URL("../../service/migrations", import.meta.url)),
    );
  try {
    await migrateNativeDatabase(db, migrations.slice(0, 3));
    await db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES('u','Person','upgrade@example.test',1,0,1,1)",
      )
      .run();
    await db.prepare("INSERT INTO organization VALUES('o','Org','u',1)").run();
    await db
      .prepare("INSERT INTO service_audit VALUES('audit','o','u','organization.created','o',1)")
      .run();
    await db
      .prepare(
        "INSERT INTO reimbursement_policy VALUES('p','o','k','v','Policy',1,100,'0.3','u',1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO reimbursement_assignment VALUES('a','o','u','d','s','v','c','cost','p',1,100,'u',1)",
      )
      .run();
    await db.prepare("INSERT INTO reimbursement_assignment_end VALUES('a',50,'u',1)").run();
    await migrateNativeDatabase(db, migrations);
    expect(
      await db.prepare("SELECT actor_id,recovery_release_id FROM service_audit").first(),
    ).toEqual({ actor_id: "u", recovery_release_id: null });
    expect(
      await db
        .prepare(
          "SELECT created_by,recovery_release_id,effective_until FROM reimbursement_assignment_end",
        )
        .first(),
    ).toEqual({ created_by: "u", recovery_release_id: null, effective_until: 50 });
    await expect(db.prepare("UPDATE service_audit SET actor_id=NULL").run()).rejects.toThrow(
      /CHECK/,
    );
    await expect(
      db.prepare("UPDATE reimbursement_assignment_end SET recovery_release_id='both'").run(),
    ).rejects.toThrow(/CHECK/);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
