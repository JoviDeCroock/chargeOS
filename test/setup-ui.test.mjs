import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../deploy/setup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../deploy/setup.js", import.meta.url), "utf8");
const TOKEN = "synthetic-owner-token-for-the-setup-handoff-0123";
const CONSOLE = "https://charge.example.be";
const windows = [];
afterEach(() => windows.splice(0).forEach((w) => w.close()));

function page() {
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:9099/#${"a".repeat(64)}`,
    runScripts: "outside-only",
  });
  const w = dom.window;
  windows.push(w);
  Object.defineProperty(w, "crypto", { value: webcrypto });
  return w;
}

/** Submits the owner form and returns the window once the result is shown. */
async function deployed(w, response) {
  w.fetch = vi.fn(async () => ({ ok: true, json: async () => response }));
  w.eval(script);
  const d = w.document;
  for (const [key, value] of Object.entries({
    name: "synthetic-home",
    ownerDomain: "charge.example.be",
    ocppDomain: "ocpp.example.be",
    email: "owner@example.test",
  }))
    d.getElementById(key).value = value;
  d.getElementById("confirmed").checked = true;
  d.getElementById("setup").dispatchEvent(
    new w.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: d.querySelector('button[value="deploy"]'),
    }),
  );
  await vi.waitFor(() => expect(d.getElementById("result").hidden).toBe(false));
  return w.fetch;
}

function message(w, data, origin, source) {
  const event = new w.Event("message");
  Object.defineProperties(event, {
    data: { value: data },
    origin: { value: origin },
    source: { value: source },
  });
  w.dispatchEvent(event);
}

const proofFor = (token, challenge) =>
  createHmac("sha256", token).update(`chargeos-setup-sign-in-v1\n${challenge}`).digest("hex");

it("sends the owner token only to the opened console after it proves the same token", async () => {
  const w = page();
  const fetcher = await deployed(w, {
    status: "containers-started",
    consoleUrl: CONSOLE,
    ocppUrl: "wss://ocpp.example.be/HOME-1",
    directory: "/private/synthetic-home",
    signInToken: TOKEN,
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ profile: "personal" });
  expect(w.document.getElementById("result").textContent).not.toContain(TOKEN);
  expect(w.document.body.innerHTML).not.toContain(TOKEN);
  const consoleTab = { postMessage: vi.fn() };
  w.open = vi.fn(() => consoleTab);
  w.document.getElementById("open-console").click();
  expect(w.open).toHaveBeenCalledWith(`${CONSOLE}/#sign-in`, "_blank");

  // Other windows and origins are ignored.
  message(w, { type: "chargeos-sign-in-ready" }, CONSOLE, {});
  message(w, { type: "chargeos-sign-in-ready" }, "https://attacker.test", consoleTab);
  expect(consoleTab.postMessage).not.toHaveBeenCalled();

  message(w, { type: "chargeos-sign-in-ready" }, CONSOLE, consoleTab);
  const [challengeMessage, challengeOrigin] = consoleTab.postMessage.mock.calls[0];
  expect(challengeOrigin).toBe(CONSOLE);
  expect(challengeMessage).toEqual({
    type: "chargeos-sign-in-challenge",
    challenge: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const { challenge } = challengeMessage;
  // A proof for another challenge does nothing.
  message(
    w,
    {
      type: "chargeos-sign-in-proof",
      challenge: "f".repeat(64),
      proof: proofFor(TOKEN, "f".repeat(64)),
    },
    CONSOLE,
    consoleTab,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(consoleTab.postMessage).toHaveBeenCalledTimes(1);

  message(
    w,
    { type: "chargeos-sign-in-proof", challenge, proof: proofFor(TOKEN, challenge) },
    CONSOLE,
    consoleTab,
  );
  await vi.waitFor(() => expect(consoleTab.postMessage).toHaveBeenCalledTimes(2));
  expect(consoleTab.postMessage.mock.calls[1]).toEqual([
    { type: "chargeos-sign-in", token: TOKEN },
    CONSOLE,
  ]);
  // Sent once; the listener is gone.
  message(
    w,
    { type: "chargeos-sign-in-proof", challenge, proof: proofFor(TOKEN, challenge) },
    CONSOLE,
    consoleTab,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(consoleTab.postMessage).toHaveBeenCalledTimes(2);
  expect(w.localStorage.length + w.sessionStorage.length).toBe(0);
});

it("never sends the token to a console that cannot prove it holds it", async () => {
  const w = page();
  await deployed(w, {
    status: "containers-started",
    consoleUrl: CONSOLE,
    ocppUrl: "wss://ocpp.example.be/HOME-1",
    directory: "/private/synthetic-home",
    signInToken: TOKEN,
  });
  const impostor = { postMessage: vi.fn() };
  w.open = vi.fn(() => impostor);
  w.document.getElementById("open-console").click();
  message(w, { type: "chargeos-sign-in-ready" }, CONSOLE, impostor);
  const { challenge } = impostor.postMessage.mock.calls[0][0];
  message(
    w,
    {
      type: "chargeos-sign-in-proof",
      challenge,
      proof: proofFor("some-other-token-entirely", challenge),
    },
    CONSOLE,
    impostor,
  );
  await vi.waitFor(() =>
    expect(w.document.getElementById("open-console-help").textContent).toContain(
      "is not this chargeOS installation",
    ),
  );
  message(
    w,
    { type: "chargeos-sign-in-proof", challenge, proof: proofFor(TOKEN, challenge) },
    CONSOLE,
    impostor,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(impostor.postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(impostor.postMessage.mock.calls)).not.toContain(TOKEN);
});

it("offers no automatic sign-in when files were only prepared", async () => {
  const w = page();
  await deployed(w, {
    status: "prepared",
    consoleUrl: CONSOLE,
    ocppUrl: "wss://ocpp.example.be/HOME-1",
    directory: "/private/synthetic-home",
  });
  w.open = vi.fn(() => ({ postMessage: vi.fn() }));
  w.document.getElementById("open-console").click();
  expect(w.open).toHaveBeenCalledWith(CONSOLE, "_blank", "noopener");
  expect(w.document.getElementById("open-console-help").textContent).toContain("credentials.json");
});

it("hides the console choice and requires the card for managed hosting", () => {
  const w = page();
  w.eval(script);
  const d = w.document,
    target = d.getElementById("target");
  expect(d.getElementById("ownerTag").required).toBe(false);
  target.value = "coolify";
  target.dispatchEvent(new w.Event("change"));
  expect(d.getElementById("ownerTag").required).toBe(true);
  expect(d.getElementById("profile-choice").hidden).toBe(true);
});
