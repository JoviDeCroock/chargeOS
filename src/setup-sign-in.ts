import type { SetupSignInProofResponse } from "../shared/contracts.js";
import {
  SETUP_SIGN_IN_CHALLENGE,
  SETUP_SIGN_IN_PROOF,
  SETUP_SIGN_IN_PROOF_PATH,
} from "../shared/setup-sign-in.js";

/**
 * One-click sign-in from the local setup wizard. The wizard opens `<console>/#sign-in`; this tab
 * says it is ready, the wizard sends a random challenge, this tab answers with its own server's
 * HMAC of that challenge keyed by the owner token, and only then does the wizard send the token,
 * through `postMessage` addressed to this exact origin. The token never appears in a URL, so it
 * cannot land in browser history, server logs or a referrer, and a page at a wrong hostname cannot
 * prove it holds the token. Only a loopback setup page that opened this tab is believed, only once,
 * only shortly after opening, and never over an existing sign-in.
 */
export const SETUP_SIGN_IN_HASH = "#sign-in";
export const SETUP_SIGN_IN_READY = "chargeos-sign-in-ready";
export const SETUP_SIGN_IN_CHALLENGE_MESSAGE = "chargeos-sign-in-challenge";
export const SETUP_SIGN_IN_PROOF_MESSAGE = "chargeos-sign-in-proof";
export const SETUP_SIGN_IN_TOKEN = "chargeos-sign-in";
export const SETUP_SIGN_IN_WINDOW_MS = 60_000;

/** The wizard listens only on 127.0.0.1 with a random port. */
const SETUP_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/u;
/** Owner tokens are printable ASCII without spaces; the wizard issues 48 base64url characters. */
const TOKEN = /^[\x21-\x7e]{16,512}$/u;

export interface SetupSignInWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface SetupSignInHost {
  readonly location: { readonly hash: string; readonly pathname: string };
  readonly opener: SetupSignInWindow | null;
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  setTimeout(handler: () => void, timeout: number): unknown;
  /** Cuts the link back to the setup tab once the handoff is over. */
  dropOpener(): void;
}

/** Asks this console's own server for the challenge proof; `null` when it cannot answer. */
export async function requestSetupSignInProof(
  challenge: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(SETUP_SIGN_IN_PROOF_PATH, {
      body: JSON.stringify({ challenge }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<SetupSignInProofResponse>;
    return typeof body.proof === "string" && SETUP_SIGN_IN_PROOF.test(body.proof)
      ? body.proof
      : null;
  } catch {
    return null;
  }
}

/** Returns true when this tab was opened for a setup sign-in and is now waiting for the token. */
export function startSetupSignIn(
  host: SetupSignInHost,
  signedIn: () => boolean,
  apply: (token: string) => void,
  prove: (challenge: string) => Promise<string | null> = requestSetupSignInProof,
): boolean {
  if (host.location.hash !== SETUP_SIGN_IN_HASH) return false;
  host.history.replaceState(null, "", `${host.location.pathname}#/overview`);
  const opener = host.opener;
  if (!opener || signedIn()) {
    host.dropOpener();
    return false;
  }
  let done = false;
  let challenged = false;
  const finish = () => {
    if (done) return;
    done = true;
    host.removeEventListener("message", listener);
    host.dropOpener();
  };
  const listener = (event: MessageEvent) => {
    if (done || event.source !== opener || !SETUP_ORIGIN.test(event.origin)) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const { type, token, challenge } = data as {
      type?: unknown;
      token?: unknown;
      challenge?: unknown;
    };
    if (type === SETUP_SIGN_IN_CHALLENGE_MESSAGE) {
      if (challenged || typeof challenge !== "string" || !SETUP_SIGN_IN_CHALLENGE.test(challenge))
        return;
      challenged = true;
      const setupOrigin = event.origin;
      void prove(challenge).then((proof) => {
        if (done) return;
        if (!proof) return finish();
        opener.postMessage({ challenge, proof, type: SETUP_SIGN_IN_PROOF_MESSAGE }, setupOrigin);
      });
      return;
    }
    if (type !== SETUP_SIGN_IN_TOKEN || !challenged) return;
    if (typeof token !== "string" || !TOKEN.test(token)) return;
    finish();
    if (!signedIn()) apply(token);
  };
  host.addEventListener("message", listener);
  host.setTimeout(finish, SETUP_SIGN_IN_WINDOW_MS);
  // Nothing secret is sent; the wizard checks that this message came from the tab it opened.
  opener.postMessage({ type: SETUP_SIGN_IN_READY }, "*");
  return true;
}
