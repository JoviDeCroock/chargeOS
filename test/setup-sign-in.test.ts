import { describe, expect, it, vi } from "vitest";

import {
  requestSetupSignInProof,
  SETUP_SIGN_IN_CHALLENGE_MESSAGE,
  SETUP_SIGN_IN_PROOF_MESSAGE,
  SETUP_SIGN_IN_READY,
  SETUP_SIGN_IN_TOKEN,
  SETUP_SIGN_IN_WINDOW_MS,
  startSetupSignIn,
  type SetupSignInHost,
} from "../src/setup-sign-in.js";

const TOKEN = "synthetic-owner-token-0123456789abcdef";
const SETUP = "http://127.0.0.1:43123";
const CHALLENGE = "c".repeat(64);
const PROOF = "d".repeat(64);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function host(hash = "#sign-in", withOpener = true) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const timers: (() => void)[] = [];
  const opener = { postMessage: vi.fn() };
  const replaceState = vi.fn();
  const dropOpener = vi.fn();
  const value: SetupSignInHost = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    dropOpener,
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
  return { dropOpener, listeners, opener, replaceState, send, timers, value };
}

describe("setup wizard sign-in handoff", () => {
  it("does nothing unless the tab was opened for sign-in", () => {
    const test = host("#/overview");
    const apply = vi.fn();
    expect(startSetupSignIn(test.value, () => false, apply)).toBe(false);
    expect(test.replaceState).not.toHaveBeenCalled();
    expect(test.opener.postMessage).not.toHaveBeenCalled();
  });

  it("proves the owner token to the loopback opener before accepting one token", async () => {
    const test = host();
    const apply = vi.fn();
    const prove = vi.fn(async () => PROOF);
    expect(startSetupSignIn(test.value, () => false, apply, prove)).toBe(true);
    expect(test.replaceState).toHaveBeenCalledWith(null, "", "/#/overview");
    expect(test.opener.postMessage).toHaveBeenCalledWith({ type: SETUP_SIGN_IN_READY }, "*");
    // A token before any challenge is ignored.
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).not.toHaveBeenCalled();
    test.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    test.send({ challenge: "e".repeat(64), type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    await flush();
    expect(prove).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith(CHALLENGE);
    expect(test.opener.postMessage).toHaveBeenLastCalledWith(
      { challenge: CHALLENGE, proof: PROOF, type: SETUP_SIGN_IN_PROOF_MESSAGE },
      SETUP,
    );
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).toHaveBeenCalledWith(TOKEN);
    test.send({ token: `${TOKEN}-second`, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(test.listeners.size).toBe(0);
    expect(test.dropOpener).toHaveBeenCalled();
  });

  it("gives up without a proof from its own server", async () => {
    const test = host();
    const apply = vi.fn();
    startSetupSignIn(
      test.value,
      () => false,
      apply,
      async () => null,
    );
    test.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    await flush();
    expect(test.opener.postMessage).toHaveBeenCalledTimes(1);
    expect(test.listeners.size).toBe(0);
    expect(test.dropOpener).toHaveBeenCalled();
  });

  it("ignores other windows, non-loopback origins, malformed messages and late answers", async () => {
    const test = host();
    const apply = vi.fn();
    const prove = vi.fn(async () => PROOF);
    startSetupSignIn(test.value, () => false, apply, prove);
    test.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE }, SETUP, {});
    test.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE }, "https://evil.test");
    test.send(
      { challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE },
      "http://localhost:1",
    );
    test.send({ challenge: "C".repeat(64), type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    expect(prove).not.toHaveBeenCalled();
    test.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    await flush();
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN }, SETUP, {});
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN }, "https://attacker.test");
    test.send({ token: "short", type: SETUP_SIGN_IN_TOKEN });
    test.send({ token: `${TOKEN} with space`, type: SETUP_SIGN_IN_TOKEN });
    test.send({ token: 42, type: SETUP_SIGN_IN_TOKEN });
    test.send(TOKEN);
    expect(apply).not.toHaveBeenCalled();
    expect(SETUP_SIGN_IN_WINDOW_MS).toBe(60_000);
    for (const timer of test.timers) timer();
    test.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).not.toHaveBeenCalled();
    expect(test.dropOpener).toHaveBeenCalled();
  });

  it("never replaces an existing sign-in and needs an opener", async () => {
    const signedIn = host();
    const apply = vi.fn();
    expect(startSetupSignIn(signedIn.value, () => true, apply)).toBe(false);
    expect(signedIn.opener.postMessage).not.toHaveBeenCalled();
    expect(signedIn.replaceState).toHaveBeenCalled();
    expect(signedIn.dropOpener).toHaveBeenCalled();

    const orphan = host("#sign-in", false);
    expect(startSetupSignIn(orphan.value, () => false, apply)).toBe(false);
    expect(orphan.listeners.size).toBe(0);

    let authenticated = false;
    const racing = host();
    startSetupSignIn(
      racing.value,
      () => authenticated,
      apply,
      async () => PROOF,
    );
    racing.send({ challenge: CHALLENGE, type: SETUP_SIGN_IN_CHALLENGE_MESSAGE });
    await flush();
    authenticated = true;
    racing.send({ token: TOKEN, type: SETUP_SIGN_IN_TOKEN });
    expect(apply).not.toHaveBeenCalled();
  });

  it("accepts only a well-formed proof from its own server", async () => {
    const answer = (status: number, body: unknown) =>
      vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
    const ok = answer(200, { proof: PROOF });
    expect(await requestSetupSignInProof(CHALLENGE, ok)).toBe(PROOF);
    expect(vi.mocked(ok).mock.calls[0]?.[0]).toBe("/api/v1/setup-sign-in/proof");
    expect(await requestSetupSignInProof(CHALLENGE, answer(429, {}))).toBeNull();
    expect(await requestSetupSignInProof(CHALLENGE, answer(200, { proof: "x" }))).toBeNull();
    const broken = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await requestSetupSignInProof(CHALLENGE, broken)).toBeNull();
  });
});
