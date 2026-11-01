import { BrandMark } from "../brand.js";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type {
  RecoveryEnrollmentAuthentication,
  RecoveryEnrollmentAuthenticator,
  RecoveryEnrollmentStatus,
} from "../../shared/contracts.js";
import { serviceRequest as request, ServiceRequestError } from "./client.js";
import "./style.css";
import "./recovery.css";

const api = "/service/api/recovery/enrollment";
type Page = "start" | "sign-in" | "challenge" | "session";
export function RecoveryEnrollmentWorkspace() {
  const token = useSignal("");
  const page = useSignal<Page>("sign-in"),
    status = useSignal<RecoveryEnrollmentStatus | null>(null);
  const setup = useSignal<RecoveryEnrollmentAuthenticator | null>(null),
    saved = useSignal(false);
  const busy = useSignal(true),
    error = useSignal(""),
    formVersion = useSignal(0);
  const errorElement = useRef<HTMLParagraphElement>(null);
  function clearPrivateState() {
    setup.value = null;
    saved.value = false;
    status.value = null;
    formVersion.value++;
  }
  async function refresh(generation = formVersion.value) {
    const current = await request<RecoveryEnrollmentStatus>(`${api}/status`);
    if (generation !== formVersion.value) return;
    status.value = current;
    page.value = "session";
    if (status.value.phase === "ready") {
      setup.value = null;
      saved.value = false;
    }
  }
  async function load() {
    await request(`${api}/info`);
    if (token.value) {
      page.value = "start";
      return;
    }
    try {
      await refresh();
    } catch (problem) {
      if (problem instanceof ServiceRequestError && problem.status === 401) page.value = "sign-in";
      else throw problem;
    }
  }
  async function action(run: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    const generation = formVersion.value;
    try {
      await run();
    } catch (problem) {
      if (generation !== formVersion.value) return;
      if (
        problem instanceof ServiceRequestError &&
        problem.status === 401 &&
        page.value === "session"
      ) {
        clearPrivateState();
        page.value = "sign-in";
      }
      error.value =
        problem instanceof ServiceRequestError
          ? problem.message
          : "The setup service is unavailable. Try again or ask your administrator to restart it.";
    } finally {
      busy.value = false;
    }
  }
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Recovery setup · chargeOS";
    function captureLink() {
      const link = new URL(window.location.href),
        supplied = new URLSearchParams(link.hash.slice(1)).get("enroll");
      if (link.hash || link.search) window.history.replaceState(null, "", "/service/recovery");
      if (supplied) {
        clearPrivateState();
        error.value = "";
        token.value = /^[a-f0-9]{64}$/.test(supplied) ? supplied : "";
        page.value = token.value ? "start" : "sign-in";
        if (!token.value)
          error.value =
            "This private link is incomplete. Open the original link or ask your administrator for a replacement.";
      }
    }
    captureLink();
    window.addEventListener("hashchange", captureLink);
    void load()
      .catch(() => {
        error.value =
          "Recovery setup is unavailable. Ask your administrator to start the enrollment service, then try again.";
      })
      .finally(() => {
        busy.value = false;
      });
    return () => {
      window.removeEventListener("hashchange", captureLink);
      token.value = "";
      clearPrivateState();
      document.title = previousTitle;
    };
  }, []);
  useEffect(() => {
    if (error.value) errorElement.current?.focus();
  }, [error.value]);
  async function submit(form: HTMLFormElement) {
    const generation = formVersion.value;
    const values = new FormData(form);
    if (page.value === "start") {
      const nextPassword = String(values.get("newPassword") ?? ""),
        repeated = String(values.get("repeatPassword") ?? "");
      if (nextPassword !== repeated) {
        error.value = "The passwords do not match. Enter the same new password twice.";
        return;
      }
      form.reset();
      const result = await request<RecoveryEnrollmentAuthentication>(`${api}/start`, {
        token: token.value,
        newPassword: nextPassword,
      });
      if (generation !== formVersion.value) return;
      token.value = "";
      if (result.challengeRequired) {
        page.value = "challenge";
        return;
      }
      await refresh(generation);
      if (generation !== formVersion.value) return;
      const material = await request<RecoveryEnrollmentAuthenticator>(`${api}/authenticator`, {
        password: nextPassword,
      });
      if (generation !== formVersion.value) return;
      setup.value = material;
      await refresh(generation);
    } else if (page.value === "sign-in") {
      const email = String(values.get("email") ?? ""),
        password = String(values.get("password") ?? "");
      form.reset();
      const result = await request<RecoveryEnrollmentAuthentication>(`${api}/sign-in`, {
        email,
        password,
      });
      if (generation !== formVersion.value) return;
      if (result.challengeRequired) page.value = "challenge";
      else await refresh(generation);
    } else if (page.value === "challenge" || status.value?.phase === "verify-authenticator") {
      const code = String(values.get("code") ?? "");
      form.reset();
      await request(`${api}/verify`, { code });
      if (generation !== formVersion.value) return;
      await refresh(generation);
    } else {
      const password = String(values.get("password") ?? "");
      form.reset();
      const material = await request<RecoveryEnrollmentAuthenticator>(`${api}/authenticator`, {
        password,
      });
      if (generation !== formVersion.value) return;
      setup.value = material;
      await refresh(generation);
    }
  }
  let setupKey = "";
  try {
    if (setup.value) setupKey = new URL(setup.value.totpURI).searchParams.get("secret") ?? "";
  } catch {
    /* Render a retry explanation without linking an untrusted URI. */
  }
  const me = status.value;
  return (
    <div class="cs-root cs-recovery">
      <header class="cs-topbar">
        <a class="cs-brand" href="/service/recovery">
          <BrandMark />
        </a>
        <span class="cs-local">Private recovery setup</span>
        <a href="/help?guide=recovery">Recovery guide</a>
      </header>
      <main class="cs-main cs-recovery-main" aria-busy={busy.value}>
        <div class="cs-heading">
          <h1>
            {me?.phase === "ready" ? "Your new sign-in is ready" : "Set up your recovery sign-in"}
          </h1>
          <p>
            Your administrator has reviewed access to a restored employer service. Choose fresh
            credentials here. Company access stays paused until the administrator completes
            reopening.
          </p>
        </div>
        {error.value && (
          <p class="cs-error" role="alert" tabIndex={-1} ref={errorElement}>
            {error.value}
          </p>
        )}
        {busy.value && (
          <p role="status" class="cs-muted">
            Checking your private setup…
          </p>
        )}
        <section class="cs-card cs-recovery-form" aria-label="Recovery credential setup">
          {page.value === "start" && (
            <>
              <h2>Choose a new password</h2>
              <p>
                Use a password you have not used for this service before. Your private link works
                once.
              </p>
              <form
                key={`start-${formVersion.value}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(() => submit(event.currentTarget));
                }}
              >
                <label>
                  New password
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    disabled={busy.value}
                  />
                </label>
                <label>
                  Repeat new password
                  <input
                    name="repeatPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    disabled={busy.value}
                  />
                </label>
                <button class="cs-primary" disabled={busy.value || !token.value}>
                  Continue to authenticator setup
                </button>
              </form>
              <p class="cs-muted">
                If the link has already been used, sign in with the new password you chose. If you
                have not finished choosing one, ask for a replacement link.
              </p>
            </>
          )}
          {page.value === "sign-in" && (
            <>
              <h2>Continue your setup</h2>
              <p>
                Use the new password chosen through your private recovery link. Old passwords cannot
                be used here.
              </p>
              <form
                key={`signin-${formVersion.value}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(() => submit(event.currentTarget));
                }}
              >
                <label>
                  Recovery email
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    disabled={busy.value}
                  />
                </label>
                <label>
                  New recovery password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    minLength={12}
                    maxLength={128}
                    required
                    disabled={busy.value}
                  />
                </label>
                <button class="cs-primary" disabled={busy.value}>
                  Continue setup
                </button>
              </form>
              <p class="cs-muted">
                Starting for the first time? Open the private link your administrator gave you.
              </p>
            </>
          )}
          {page.value === "challenge" && (
            <>
              <h2>Confirm your authenticator</h2>
              <p>
                Enter the current six-digit code from the authenticator you added during this
                recovery.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(() => submit(event.currentTarget));
                }}
              >
                <label>
                  Authenticator code
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    disabled={busy.value}
                  />
                </label>
                <button class="cs-primary" disabled={busy.value}>
                  Confirm code
                </button>
              </form>
            </>
          )}
          {page.value === "session" && me && (
            <>
              <p class="cs-recovery-identity">
                {me.user.name}
                <br />
                <span>{me.user.email}</span>
              </p>
              {me.phase === "set-authenticator" && (
                <>
                  <h2>Add your new authenticator</h2>
                  <p>
                    Confirm the new recovery password to continue. You will receive a fresh setup
                    key and recovery codes.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(() => submit(event.currentTarget));
                    }}
                  >
                    <label>
                      New recovery password
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        minLength={12}
                        maxLength={128}
                        required
                        disabled={busy.value}
                      />
                    </label>
                    <button class="cs-primary" disabled={busy.value}>
                      Create authenticator setup
                    </button>
                  </form>
                </>
              )}
              {me.phase === "verify-authenticator" && (
                <>
                  <h2>Verify your new authenticator</h2>
                  {setup.value ? (
                    <>
                      <p>
                        In your authenticator app, add an account with a setup key. Name it chargeOS
                        and enter this key:
                      </p>
                      <code class="cs-recovery-secret">
                        {setupKey ||
                          "Setup key unavailable. Ask your administrator for a new private link."}
                      </code>
                      <h3>Save these recovery codes privately</h3>
                      <p>
                        You will need them if you lose the authenticator. This page clears them
                        after verification. Keep them in your password manager or another private
                        place.
                      </p>
                      <ul class="cs-recovery-codes">
                        {setup.value.backupCodes.map((code) => (
                          <li key={code}>
                            <code>{code}</code>
                          </li>
                        ))}
                      </ul>
                      <label class="cs-recovery-check">
                        <input
                          type="checkbox"
                          checked={saved.value}
                          onChange={(event) => {
                            saved.value = event.currentTarget.checked;
                          }}
                          disabled={busy.value}
                        />
                        I saved my recovery codes privately
                      </label>
                    </>
                  ) : (
                    <p>
                      Use the authenticator you already added. If you closed the page before saving
                      its setup key and recovery codes, ask your administrator for a replacement
                      setup link.
                    </p>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(() => submit(event.currentTarget));
                    }}
                  >
                    <label>
                      Six-digit authenticator code
                      <input
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={busy.value}
                      />
                    </label>
                    <button
                      class="cs-primary"
                      disabled={busy.value || (!!setup.value && !saved.value)}
                    >
                      Verify new authenticator
                    </button>
                  </form>
                </>
              )}
              {me.phase === "ready" && (
                <>
                  <h2>Credential setup complete</h2>
                  <p>
                    Your new password and authenticator have been verified. Tell your administrator
                    you are ready; they still need to complete reopening.
                  </p>
                  <p>
                    When the employer service reopens, sign in again with these new credentials.
                    This setup session grants no company or charging-station access.
                  </p>
                </>
              )}
            </>
          )}
          <div class="cs-auth-links">
            {page.value !== "sign-in" && page.value !== "session" && (
              <button
                type="button"
                disabled={busy.value}
                onClick={() => {
                  clearPrivateState();
                  token.value = "";
                  page.value = "sign-in";
                  error.value = "";
                }}
              >
                I already chose a new password
              </button>
            )}
            {me && (
              <button
                type="button"
                disabled={busy.value}
                onClick={() =>
                  void action(async () => {
                    await request(`${api}/sign-out`, {});
                    clearPrivateState();
                    token.value = "";
                    page.value = "sign-in";
                  })
                }
              >
                Sign out and clear this page
              </button>
            )}
            <button type="button" disabled={busy.value} onClick={() => void action(load)}>
              Check setup connection
            </button>
          </div>
        </section>
        <p class="cs-muted">
          Keep private setup links, keys and codes out of support messages and screenshots. Setup
          stays local and expires when the current recovery review expires.
        </p>
      </main>
    </div>
  );
}
