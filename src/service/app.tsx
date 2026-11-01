import { serviceRequest as request, ServiceRequestError } from "./client.js";
import { ReimbursementWorkspace } from "./reimbursements.js";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type {
  OrganizationWorkspace,
  ServiceAccount,
  ServiceOrganization,
  ServiceHealth,
} from "../../shared/contracts.js";
import "./style.css";

const api = "/service/api/v1";
const auth = "/service/api/auth";
type Page = "sign-in" | "sign-up" | "forgot" | "reset" | "challenge";
type AuthResult = { twoFactorRedirect?: boolean; totpURI?: string; backupCodes?: string[] };
function fields(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

export function ServiceWorkspace({ hostedPage = false }: { hostedPage?: boolean } = {}) {
  const account = useSignal<ServiceAccount | null>(null);
  const workspace = useSignal<OrganizationWorkspace | null>(null);
  const busy = useSignal(true);
  const error = useSignal("");
  const notice = useSignal("");
  const page = useSignal<Page>("sign-in");
  const invitationToken = useSignal("");
  const resetToken = useSignal("");
  const setup = useSignal<{ uri: string; backupCodes: string[] } | null>(null);
  const health = useSignal<ServiceHealth | null>(null);

  async function refresh(selectedId?: string) {
    const me = await request<ServiceAccount>(`${api}/me`);
    account.value = me;
    const id = selectedId ?? workspace.value?.organization.id ?? me.organizations[0]?.id;
    workspace.value =
      id && me.organizations.some((org) => org.id === id)
        ? await request<OrganizationWorkspace>(`${api}/organizations/${id}`)
        : null;
  }
  async function action(run: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      await run();
    } catch (problem) {
      if (problem instanceof ServiceRequestError && problem.status === 401) {
        account.value = null;
        workspace.value = null;
        setup.value = null;
        page.value = "sign-in";
      }
      error.value = problem instanceof Error ? problem.message : "Please try again.";
    } finally {
      busy.value = false;
    }
  }
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Company accounts · chargeOS";
    function captureLink() {
      const url = new URL(window.location.href);
      const invite = new URLSearchParams(url.hash.slice(1)).get("invite");
      const reset = url.searchParams.get("token");
      if (invite) invitationToken.value = invite;
      if (reset) {
        resetToken.value = reset;
        page.value = "reset";
      }
      if (invite || reset) window.history.replaceState(null, "", "/service");
    }
    captureLink();
    window.addEventListener("hashchange", captureLink);
    let mounted = true;
    void request<ServiceHealth>(`${api}/health`)
      .then((value) => {
        if (!mounted) return;
        if (!["smtp-queue", "operator-only-local-outbox"].includes(value.delivery))
          throw new Error(
            "Account delivery settings are unavailable. Reload the page to try again.",
          );
        health.value = value;
        return refresh();
      })
      .catch((problem: unknown) => {
        // A signed-out account is expected. Configuration/network errors stay visible.
        if (!(problem instanceof Error) || problem.message !== "Sign in to continue")
          error.value =
            problem instanceof Error ? problem.message : "The account service is unavailable.";
      })
      .finally(() => {
        busy.value = false;
      });
    return () => {
      document.title = previousTitle;
      mounted = false;
      window.removeEventListener("hashchange", captureLink);
      setup.value = null;
      invitationToken.value = "";
      resetToken.value = "";
    };
  }, []);

  async function submitAccount(form: HTMLFormElement) {
    if (["sign-up", "forgot"].includes(page.value) && !health.value)
      throw new Error(
        "Account delivery settings are unavailable. Reload the page before requesting a link.",
      );
    const values = fields(form);
    if (page.value === "sign-up") {
      await request(`${auth}/sign-up/email`, {
        ...values,
        callbackURL: `${window.location.origin}/service`,
      });
      form.reset();
      page.value = "sign-in";
      notice.value =
        health.value?.delivery === "smtp-queue"
          ? "Account created. Check your inbox for the verification link, then sign in. If it does not arrive, ask your administrator to check email delivery."
          : "Account created. Open its verification link from the local operator outbox, then sign in.";
    } else if (page.value === "forgot") {
      await request(`${auth}/request-password-reset`, {
        email: values.email,
        redirectTo: `${window.location.origin}/service`,
      });
      form.reset();
      notice.value =
        health.value?.delivery === "smtp-queue"
          ? "If the account exists, its recovery link has been queued for email. Check your inbox; if it does not arrive, ask your administrator to check email delivery."
          : "If the account exists, a recovery link is available in the local operator outbox.";
    } else if (page.value === "reset") {
      await request(`${auth}/reset-password`, {
        token: resetToken.value,
        newPassword: values.password,
      });
      resetToken.value = "";
      form.reset();
      page.value = "sign-in";
      notice.value = "Password updated. Previous sessions have been signed out.";
    } else if (page.value === "challenge") {
      const endpoint = values.method === "backup" ? "verify-backup-code" : "verify-totp";
      await request(`${auth}/two-factor/${endpoint}`, { code: values.code, trustDevice: false });
      form.reset();
      await refresh();
    } else {
      const result = await request<AuthResult>(`${auth}/sign-in/email`, values);
      form.reset();
      if (result.twoFactorRedirect) page.value = "challenge";
      else await refresh();
    }
  }
  const hosted = hostedPage || health.value?.mode === "self-hosted";
  const me = account.value;
  const current = workspace.value;
  return (
    <div class="cs-root">
      <header class="cs-topbar">
        <a class="cs-brand" href="/service">
          <span aria-hidden="true">c</span>chargeOS
        </a>
        <span class="cs-local">
          {hosted
            ? "Company accounts · no charger connection"
            : "Local development · no charger connection"}
        </span>
        {me && (
          <button
            type="button"
            disabled={busy.value}
            onClick={() =>
              void action(async () => {
                await request(`${auth}/sign-out`, {});
                account.value = null;
                workspace.value = null;
                setup.value = null;
                page.value = "sign-in";
              })
            }
          >
            Sign out
          </button>
        )}
      </header>
      <main class="cs-main">
        <div class="cs-heading">
          <h1>{me ? `Welcome, ${me.user.name.split(" ")[0]}.` : "Your charging. Your terms."}</h1>
          <p>
            {me
              ? "Manage your organization and the people who belong to it."
              : "One account for your driver and employer workspace."}
          </p>
        </div>
        <aside class="cs-local-note">
          {hosted
            ? "Use your approved work email address. Verification, invitations and password recovery arrive by email. Your company account manages access and reimbursement records; charger ownership stays with its owner."
            : health.value?.delivery === "smtp-queue"
              ? "This local trial emails verification, invitation and recovery links through your administrator’s mail provider. Open localhost links on this computer. Email delivery does not make this a public company portal."
              : health.value
                ? "This service runs on your computer. Verification, invitation and recovery links stay in the operator’s local database outbox. No email is sent. This mode does not prove ownership of a real email address."
                : "Checking how account links are delivered…"}
        </aside>
        {busy.value && <p role="status">Working…</p>}
        {error.value && (
          <div class="cs-message cs-error" role="alert">
            {error.value}
          </div>
        )}
        {notice.value && (
          <div class="cs-message" role="status">
            {notice.value}
          </div>
        )}
        {!me ? (
          <section class="cs-card cs-auth">
            <h2>
              {
                {
                  "sign-in": "Sign in",
                  "sign-up": "Create your account",
                  forgot: "Recover your account",
                  reset: "Choose a new password",
                  challenge: "Verify your sign-in",
                }[page.value]
              }
            </h2>
            {invitationToken.value && (
              <p>
                An organization invitation is ready. Sign in with the invited email address to
                accept it.
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void action(() => submitAccount(form));
              }}
            >
              {page.value === "sign-up" && (
                <label>
                  Full name
                  <input name="name" required maxLength={120} autoComplete="name" />
                </label>
              )}
              {["sign-in", "sign-up", "forgot"].includes(page.value) && (
                <label>
                  Email address
                  <input name="email" type="email" required maxLength={254} autoComplete="email" />
                </label>
              )}
              {["sign-in", "sign-up", "reset"].includes(page.value) && (
                <label>
                  Password
                  <input
                    name="password"
                    aria-label="Password"
                    aria-describedby="cs-password-help"
                    type="password"
                    required
                    minLength={page.value === "sign-in" ? 1 : 12}
                    maxLength={128}
                    autoComplete={page.value === "sign-in" ? "current-password" : "new-password"}
                  />
                  <small id="cs-password-help">
                    {page.value !== "sign-in" && "Use at least 12 characters."}
                  </small>
                </label>
              )}
              {page.value === "challenge" && (
                <>
                  <label>
                    Verification method
                    <select name="method" aria-label="Verification method">
                      <option value="totp">Authenticator app</option>
                      <option value="backup">Recovery code</option>
                    </select>
                  </label>
                  <label>
                    Code
                    <input name="code" required autoComplete="one-time-code" />
                  </label>
                </>
              )}
              <button class="cs-primary" disabled={busy.value} type="submit">
                {page.value === "sign-up"
                  ? "Create account"
                  : page.value === "forgot"
                    ? "Request recovery link"
                    : page.value === "reset"
                      ? "Update password"
                      : page.value === "challenge"
                        ? "Verify code"
                        : "Sign in"}
              </button>
            </form>
            <div class="cs-auth-links">
              {page.value !== "sign-in" && (
                <button
                  disabled={busy.value}
                  type="button"
                  onClick={() => {
                    page.value = "sign-in";
                  }}
                >
                  Back to sign in
                </button>
              )}
              {page.value === "sign-in" && (
                <>
                  <button
                    disabled={busy.value}
                    type="button"
                    onClick={() => {
                      page.value = "sign-up";
                    }}
                  >
                    Create account
                  </button>
                  <button
                    disabled={busy.value}
                    type="button"
                    onClick={() => {
                      page.value = "forgot";
                    }}
                  >
                    Forgot password?
                  </button>
                </>
              )}
            </div>
          </section>
        ) : (
          <>
            {invitationToken.value && (
              <section class="cs-card cs-invitation">
                <div>
                  <h2>Join your organization</h2>
                  <p>Accept the invitation addressed to {me.user.email}.</p>
                </div>
                <button
                  class="cs-primary"
                  type="button"
                  disabled={busy.value}
                  onClick={() =>
                    void action(async () => {
                      const result = await request<{ organizationId: string }>(
                        `${api}/invitations/accept`,
                        { token: invitationToken.value },
                      );
                      invitationToken.value = "";
                      await refresh(result.organizationId);
                      notice.value = "You’ve joined the organization.";
                    })
                  }
                >
                  Accept invitation
                </button>
              </section>
            )}
            <div class="cs-grid">
              <section class="cs-card">
                <h2>Your organizations</h2>
                {me.organizations.length > 0 ? (
                  <label>
                    Active organization
                    <select
                      value={current?.organization.id ?? ""}
                      disabled={busy.value}
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        void action(() => refresh(id));
                      }}
                    >
                      {me.organizations.map((org) => (
                        <option value={org.id} key={org.id}>
                          {org.name} · {org.role}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p>
                    You haven’t joined an organization yet. Accept an invitation or create one for
                    your team.
                  </p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const values = fields(form);
                    void action(async () => {
                      const org = await request<ServiceOrganization>(
                        `${api}/organizations`,
                        values,
                      );
                      form.reset();
                      await refresh(org.id);
                      notice.value = "Organization created.";
                    });
                  }}
                >
                  <label>
                    New organization name
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="Your employer or team"
                    />
                  </label>
                  <button type="submit" disabled={busy.value}>
                    Create organization
                  </button>
                </form>
              </section>
              <section class="cs-card">
                <h2>Account security</h2>
                <p>{me.user.email}</p>
                <div class="cs-security-status">
                  <span>Email verified</span>
                  <span>{me.user.twoFactorEnabled ? "MFA enabled" : "MFA not enabled"}</span>
                </div>
                {!me.user.twoFactorEnabled && !setup.value && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const values = fields(form);
                      void action(async () => {
                        const result = await request<AuthResult>(`${auth}/two-factor/enable`, {
                          password: values.password,
                          method: "totp",
                        });
                        form.reset();
                        if (!result.totpURI || !result.backupCodes)
                          throw new Error(
                            "Authenticator setup did not return its recovery material.",
                          );
                        setup.value = { uri: result.totpURI, backupCodes: result.backupCodes };
                      });
                    }}
                  >
                    <label>
                      Confirm password to set up MFA
                      <input
                        name="password"
                        type="password"
                        required
                        autoComplete="current-password"
                      />
                    </label>
                    <button type="submit" disabled={busy.value}>
                      Set up authenticator
                    </button>
                  </form>
                )}
                {setup.value && (
                  <div class="cs-mfa">
                    <p>
                      Enter this setup key in your authenticator app. Store the recovery codes
                      separately before continuing.
                    </p>
                    <label>
                      Authenticator setup key
                      <input
                        readOnly
                        value={new URL(setup.value.uri).searchParams.get("secret") ?? ""}
                      />
                    </label>
                    <label>
                      Recovery codes
                      <textarea readOnly rows={5} value={setup.value.backupCodes.join("\n")} />
                    </label>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = fields(event.currentTarget);
                        void action(async () => {
                          await request(`${auth}/two-factor/verify-totp`, {
                            code: values.code,
                            trustDevice: false,
                          });
                          setup.value = null;
                          await refresh();
                          notice.value = "Authenticator verified. MFA is now enabled.";
                        });
                      }}
                    >
                      <label class="cs-checkbox">
                        <input type="checkbox" required />I stored my recovery codes
                      </label>
                      <label>
                        Authenticator code
                        <input
                          name="code"
                          required
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                        />
                      </label>
                      <button class="cs-primary" type="submit" disabled={busy.value}>
                        Verify and enable MFA
                      </button>
                    </form>
                  </div>
                )}
                <p class="cs-muted">
                  Organization roles grant access to this service. Physical charger ownership and
                  local owner RFID access stay separate.
                </p>
              </section>
            </div>
            {current && (
              <section class="cs-card">
                <div class="cs-section-heading">
                  <div>
                    <p class="cs-eyebrow">{current.organization.role} workspace</p>
                    <h2>{current.organization.name}</h2>
                  </div>
                  <span class="cs-tag">No stations connected</span>
                </div>
                {current.organization.role === "admin" ? (
                  <>
                    <h3>People</h3>
                    <ul class="cs-people">
                      {current.members.map((member) => (
                        <li key={member.id}>
                          <div>
                            <strong>{member.name}</strong>
                            <span>{member.email}</span>
                          </div>
                          <span class="cs-tag">{member.role}</span>
                          {member.userId !== me.user.id && (
                            <button
                              type="button"
                              disabled={busy.value}
                              onClick={() =>
                                void action(async () => {
                                  await request(
                                    `${api}/organizations/${current.organization.id}/members/${member.id}`,
                                    {},
                                    "DELETE",
                                  );
                                  await refresh();
                                  notice.value =
                                    "Membership removed. Organization access has ended.";
                                })
                              }
                            >
                              Remove access
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <h3>Invite a colleague</h3>
                    <form
                      class="cs-inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const values = fields(form);
                        void action(async () => {
                          await request(
                            `${api}/organizations/${current.organization.id}/invitations`,
                            values,
                          );
                          form.reset();
                          await refresh();
                          notice.value =
                            health.value?.delivery === "smtp-queue"
                              ? "Invitation queued for email. It expires in 72 hours. If it does not arrive, check email delivery with your administrator."
                              : "Invitation saved to the local operator outbox. It expires in 72 hours.";
                        });
                      }}
                    >
                      <label>
                        Email address
                        <input name="email" type="email" required maxLength={254} />
                      </label>
                      <label>
                        Role
                        <select name="role" aria-label="Role">
                          <option value="driver">Driver</option>
                          <option value="finance">Finance</option>
                        </select>
                      </label>
                      <button class="cs-primary" type="submit" disabled={busy.value}>
                        Invite colleague
                      </button>
                    </form>
                    {current.invitations.length > 0 && (
                      <>
                        <h3>Invitations</h3>
                        <ul class="cs-people">
                          {current.invitations.map((offer) => (
                            <li key={offer.id}>
                              <div>
                                <strong>{offer.email}</strong>
                                <span>
                                  {offer.role} · {offer.status}
                                </span>
                              </div>
                              {offer.status === "pending" && (
                                <button
                                  type="button"
                                  disabled={busy.value}
                                  onClick={() =>
                                    void action(async () => {
                                      await request(
                                        `${api}/organizations/${current.organization.id}/invitations/${offer.id}`,
                                        {},
                                        "DELETE",
                                      );
                                      await refresh();
                                      notice.value = "Invitation revoked.";
                                    })
                                  }
                                >
                                  Revoke invitation
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <p>
                    Your {current.organization.role} membership is active. Your reimbursement
                    records are below. Charging controls and payments are still being built.
                  </p>
                )}
              </section>
            )}
            {current && (
              <ReimbursementWorkspace
                key={current.organization.id}
                organization={current.organization}
                actorId={me.user.id}
                mfaEnabled={me.user.twoFactorEnabled}
                onSessionExpired={() => {
                  account.value = null;
                  workspace.value = null;
                  setup.value = null;
                  page.value = "sign-in";
                }}
              />
            )}
          </>
        )}
        <footer class="cs-footer">
          <a href="/help">Help and setup guides</a>
          {!hosted && (
            <>
              <a href="/preview">Explore the fictional product preview</a>
              <a href="/observe">Open local CSV observation</a>
              <a href="/">Owner console</a>
            </>
          )}
        </footer>
      </main>
    </div>
  );
}
