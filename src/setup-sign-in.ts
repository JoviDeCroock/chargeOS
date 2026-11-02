/**
 * One-click sign-in from the local setup wizard. The wizard opens `<console>/#sign-in`; this page
 * says it is ready, and the wizard answers with the owner token through `postMessage` addressed to
 * this exact origin. The token never appears in a URL, so it cannot land in browser history,
 * server logs or a referrer. Only a loopback setup page that opened this tab is believed, only
 * once, only shortly after opening, and never over an existing sign-in.
 */
export const SETUP_SIGN_IN_HASH = "#sign-in";
export const SETUP_SIGN_IN_READY = "chargeos-sign-in-ready";
export const SETUP_SIGN_IN_TOKEN = "chargeos-sign-in";
export const SETUP_SIGN_IN_WINDOW_MS = 60_000;

/** The wizard listens only on 127.0.0.1 with a random port. */
const SETUP_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/u;
/** Owner tokens are printable ASCII without spaces; the wizard issues 48 base64url characters. */
const TOKEN = /^[\x21-\x7e]{16,512}$/u;

export interface SetupSignInHost {
  readonly location: { readonly hash: string; readonly pathname: string };
  readonly opener: { postMessage(message: unknown, targetOrigin: string): void } | null;
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  setTimeout(handler: () => void, timeout: number): unknown;
}

/** Returns true when this tab was opened for a setup sign-in and is now waiting for the token. */
export function startSetupSignIn(
  host: SetupSignInHost,
  signedIn: () => boolean,
  apply: (token: string) => void,
): boolean {
  if (host.location.hash !== SETUP_SIGN_IN_HASH) return false;
  host.history.replaceState(null, "", `${host.location.pathname}#/overview`);
  const opener = host.opener;
  if (!opener || signedIn()) return false;
  let done = false;
  const finish = () => {
    done = true;
    host.removeEventListener("message", listener);
  };
  const listener = (event: MessageEvent) => {
    if (done || event.source !== opener || !SETUP_ORIGIN.test(event.origin)) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const { type, token } = data as { type?: unknown; token?: unknown };
    if (type !== SETUP_SIGN_IN_TOKEN || typeof token !== "string" || !TOKEN.test(token)) return;
    finish();
    if (!signedIn()) apply(token);
  };
  host.addEventListener("message", listener);
  host.setTimeout(finish, SETUP_SIGN_IN_WINDOW_MS);
  // Nothing secret is sent; the wizard checks that this message came from the tab it opened.
  opener.postMessage({ type: SETUP_SIGN_IN_READY }, "*");
  return true;
}
