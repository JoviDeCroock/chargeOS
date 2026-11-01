import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

it("backs up a released service and restores it without the old config into a new quarantined epoch with no release authority", async () => {
  const released = await release(),
    bundle = join(f.directory, "released.bundle"),
    checkpoint = join(f.directory, "released-checkpoint.json"),
    target = join(f.directory, "second-restore"),
    phrase = "a second synthetic backup passphrase!";
  await exportCommercialRecovery(f.configuration, f.data, bundle, phrase);
  await checkpointNativeCommercial(f.configuration, f.data, checkpoint);
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
    const old = JSON.parse(
      await live
        .prepare("SELECT receipt_json FROM _chargeos_native_release_history WHERE release_id=?")
        .bind(released.releaseId)
        .first("receipt_json"),
    );
    old.receipt.origin = "http://127.0.0.1:1234";
    await live
      .prepare("UPDATE _chargeos_native_release_history SET receipt_json=? WHERE release_id=?")
      .bind(JSON.stringify(old), released.releaseId)
      .run();
  } finally {
    live.close();
  }
  expect(
    () =>
      new NativeCommercialDatabase(data, {
        recoveryOrigin: fresh.SERVICE_ORIGIN,
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
