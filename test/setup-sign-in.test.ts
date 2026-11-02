import { describe, expect, it, vi } from "vitest";

import {
  SETUP_SIGN_IN_READY,
  SETUP_SIGN_IN_TOKEN,
  SETUP_SIGN_IN_WINDOW_MS,
  startSetupSignIn,
  type SetupSignInHost,
} from "../src/setup-sign-in.js";

const TOKEN = "synthetic-owner-token-0123456789abcdef";
const SETUP = "http://127.0.0.1:43123";

function host(hash = "#sign-in", withOpener = true) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const timers: (() => void)[] = [];
  const opener = { postMessage: vi.fn() };
  const replaceState = vi.fn();
  const value: SetupSignInHost = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    history: { replaceState },
    location: { hash, pathname: "/" },
    opener: withOpener ? opener : null,
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    setTimeout: (handler) => void timers.push(handler),
  };
  const send = (data: unknown, origin = SETUP, source: unknown = opener) => {
    for (const listener of Array.from(listeners))
      listener({ data, origin, source } as unknown as MessageEvent);
  };
  return { listeners, opener, replaceState, send, timers, value };
}

describe("setup wizard sign-in handoff", () => {
  it("does nothing unless the tab was opened for sign-in", () => {
    const test = host("#/overview");
    const apply = vi.fn();
    expect(startSetupSignIn(test.value, () => false, apply)).toBe(false);
    expect(test.replaceState).not.toHaveBeenCalled();
    expect(test.opener.postMessage).not.toHaveBeenCalled();
  });

  it("announces readiness without secrets and accepts one token from the loopback opener", () => {
    const test = host();
    const apply = vi.fn();
    expect(startSetupSignIn(test.value, () => false, apply)).toBe(true);
    expect(test.replaceState).toHaveBeenCalledWith(null, "", "/#/overview");
    expect(test.opener.postMessage).toHaveBeenCalledWith({ type: SETUP_SIGN_IN_READY }, "*");
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).toHaveBeenCalledWith(TOKEN);
    test.send({ token: `${TOKEN}-second`, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(test.listeners.size).toBe(0);
  });

  it("ignores other windows, non-loopback origins, malformed messages and late answers", () => {
    const test = host();
    const apply = vi.fn();
    startSetupSignIn(test.value, () => false, apply);
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN }, SETUP, {});
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN }, "https://attacker.test");
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN }, "http://localhost:43123");
    test.send({ token: "short", type: SETUP_SIGN_IN_TOKEN });
    test.send({ token: `${TOKEN} with space`, type: SETUP_SIGN_IN_TOKEN });
    test.send({ token: 42, type: SETUP_SIGN_IN_TOKEN });
    test.send(TOKEN);
    expect(apply).not.toHaveBeenCalled();
    expect(SETUP_SIGN_IN_WINDOW_MS).toBe(60_000);
    for (const timer of test.timers) timer();
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).not.toHaveBeenCalled();
  });

  it("never replaces an existing sign-in and needs an opener", () => {
    const signedIn = host();
    const apply = vi.fn();
    expect(startSetupSignIn(signedIn.value, () => true, apply)).toBe(false);
    expect(signedIn.opener.postMessage).not.toHaveBeenCalled();
    expect(signedIn.replaceState).toHaveBeenCalled();

    const orphan = host("#sign-in", false);
    expect(startSetupSignIn(orphan.value, () => false, apply)).toBe(false);
    expect(orphan.listeners.size).toBe(0);

    let authenticated = false;
    const racing = host();
    startSetupSignIn(racing.value, () => authenticated, apply);
    authenticated = true;
    racing.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).not.toHaveBeenCalled();
  });
});
