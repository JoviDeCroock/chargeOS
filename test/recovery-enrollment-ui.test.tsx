// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryEnrollmentWorkspace } from "../src/service/recovery.js";

const reply = (value: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
const status = (phase: string) => ({
  mode: "recovery-enrollment",
  phase,
  user: { name: "Synthetic Recovery User", email: "reviewed@example.test" },
  expiresAt: "2026-11-02T00:00:00.000Z",
  reopeningAllowed: false,
});
beforeEach(() => {
  window.history.replaceState(null, "", `/service/recovery#enroll=${"a".repeat(64)}`);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const fill = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

it("removes the private fragment, completes fresh setup and clears passwords, setup keys and backup codes without any business or owner request", async () => {
  let phase = "set-authenticator";
  const calls = vi.fn(async (path: string) => {
    if (path.endsWith("/info")) return reply({ mode: "recovery-enrollment" });
    if (path.endsWith("/status")) return reply(status(phase));
    if (path.endsWith("/start"))
      return reply({ challengeRequired: false, reopeningAllowed: false });
    if (path.endsWith("/authenticator")) {
      phase = "verify-authenticator";
      return reply({
        totpURI: "otpauth://totp/chargeOS?secret=SYNTHETICSETUPKEY",
        backupCodes: ["synthetic-code-one", "synthetic-code-two"],
      });
    }
    if (path.endsWith("/verify")) {
      phase = "ready";
      return reply({ verified: true });
    }
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", calls);
  render(<RecoveryEnrollmentWorkspace />);
  await screen.findByRole("heading", { name: "Choose a new password" });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Continue to authenticator setup" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(window.location.hash).toBe("");
  fill("New password", "new synthetic recovery password!");
  fill("Repeat new password", "new synthetic recovery password!");
  fireEvent.submit(
    screen.getByRole("button", { name: "Continue to authenticator setup" }).closest("form")!,
  );
  await screen.findByText("SYNTHETICSETUPKEY");
  expect(
    screen.getByRole("button", { name: "Verify new authenticator" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("I saved my recovery codes privately"));
  fill("Six-digit authenticator code", "123456");
  fireEvent.submit(
    screen.getByRole("button", { name: "Verify new authenticator" }).closest("form")!,
  );
  await screen.findByRole("heading", { name: "Credential setup complete" });
  expect(screen.queryByText("SYNTHETICSETUPKEY")).toBeNull();
  expect(screen.queryByText("synthetic-code-one")).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(localStorage.length + sessionStorage.length).toBe(0);
  expect(
    calls.mock.calls.every(([path]) => path.startsWith("/service/api/recovery/enrollment/")),
  ).toBe(true);
});

it("discards a previous user's in-flight response when another private setup link opens in the same tab", async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  const calls = vi.fn(async (path: string) =>
    path.endsWith("/info")
      ? reply({})
      : path.endsWith("/start")
        ? await new Promise<ReturnType<typeof reply>>((resolve) => {
            finish = resolve;
          })
        : reply({ error: "Sign in" }, 401),
  );
  vi.stubGlobal("fetch", calls);
  render(<RecoveryEnrollmentWorkspace />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Continue to authenticator setup" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fill("New password", "new synthetic recovery password!");
  fill("Repeat new password", "new synthetic recovery password!");
  fireEvent.submit(
    screen.getByRole("button", { name: "Continue to authenticator setup" }).closest("form")!,
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  window.history.replaceState(null, "", `/service/recovery#enroll=${"b".repeat(64)}`);
  fireEvent(window, new Event("hashchange"));
  finish(reply({ challengeRequired: false }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Continue to authenticator setup" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(
    calls.mock.calls.some(([path]) => path.endsWith("/authenticator") || path.endsWith("/status")),
  ).toBe(false);
  expect(window.location.hash).toBe("");
  expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Synthetic Recovery User")).toBeNull();
});

it("returns from a rejected sign-in challenge without storing credentials or offering business access", async () => {
  window.history.replaceState(null, "", "/service/recovery");
  const calls = vi.fn(async (path: string) =>
    path.endsWith("/info")
      ? reply({})
      : path.endsWith("/status")
        ? reply({ error: "Sign in" }, 401)
        : path.endsWith("/sign-in")
          ? reply({ challengeRequired: true })
          : reply({ error: "Use the current authenticator code" }, 401),
  );
  vi.stubGlobal("fetch", calls);
  render(<RecoveryEnrollmentWorkspace />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue setup" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fill("Recovery email", "reviewed@example.test");
  fill("New recovery password", "new synthetic recovery password!");
  fireEvent.submit(screen.getByRole("button", { name: "Continue setup" }).closest("form")!);
  await screen.findByRole("heading", { name: "Confirm your authenticator" });
  fill("Authenticator code", "123456");
  fireEvent.submit(screen.getByRole("button", { name: "Confirm code" }).closest("form")!);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Use the current authenticator code");
  expect((screen.getByLabelText("Authenticator code") as HTMLInputElement).value).toBe("");
  expect(localStorage.length + sessionStorage.length).toBe(0);
});
