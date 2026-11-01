// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServiceWorkspace } from "../src/service/app.js";

const localHealth = {
  mode: "local-development",
  delivery: "operator-only-local-outbox",
  chargerControl: false,
};
const reply = (value: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
beforeEach(() => {
  window.history.replaceState(null, "", "/service");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("captures an invitation opened in an existing tab and removes its secret from the address bar", async () => {
  const calls = vi.fn(async (path: string) =>
    path.endsWith("/health") ? reply(localHealth) : reply({ error: "Sign in to continue" }, 401),
  );
  vi.stubGlobal("fetch", calls);
  render(<ServiceWorkspace />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }).hasAttribute("disabled"),
    ).toBe(false),
  );
  window.history.replaceState(null, "", `/service#invite=${"a".repeat(64)}`);
  fireEvent(window, new Event("hashchange"));
  expect(screen.getByText(/An organization invitation is ready/)).toBeTruthy();
  expect(window.location.hash).toBe("");
  expect(calls).toHaveBeenCalledTimes(2);
  expect(calls.mock.calls.map(([path]) => path)).toEqual([
    "/service/api/v1/health",
    "/service/api/v1/me",
  ]);
  expect(localStorage.length + sessionStorage.length).toBe(0);
});

it("clears a stale account view when a mutation discovers that the session expired", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("/health")
        ? reply(localHealth)
        : path.endsWith("/me")
          ? reply({
              mode: "local-development",
              user: {
                id: "person-1",
                name: "Mila Synthetic",
                email: "mila@example.test",
                emailVerified: true,
                twoFactorEnabled: false,
              },
              organizations: [],
            })
          : reply({ error: "Sign in to continue" }, 401),
    ),
  );
  render(<ServiceWorkspace />);
  await screen.findByRole("heading", { name: "Welcome, Mila." });
  fireEvent.input(screen.getByLabelText("New organization name"), {
    target: { value: "Expired session test" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create organization", exact: true }).closest("form")!,
  );
  await screen.findByRole("heading", { name: "Sign in", exact: true });
  expect(screen.queryByRole("heading", { name: "Account security" })).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Sign in to continue");
});

it("keeps the account locked at the MFA challenge and uses only service-scoped cookie requests", async () => {
  const calls = vi.fn(async (path: string) => {
    if (path.endsWith("/health")) return reply(localHealth);
    if (path.endsWith("/me")) return reply({ error: "Sign in to continue" }, 401);
    if (path.endsWith("/sign-in/email")) return reply({ twoFactorRedirect: true });
    return reply({ message: "Invalid authenticator code" }, 400);
  });
  vi.stubGlobal("fetch", calls);
  render(<ServiceWorkspace />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.input(screen.getByLabelText("Email address", { exact: true }), {
    target: { value: "person@example.test" },
  });
  fireEvent.input(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "synthetic password" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in", exact: true }).closest("form")!);
  await screen.findByRole("heading", { name: "Verify your sign-in" });
  expect(screen.queryByRole("heading", { name: /Welcome/ })).toBeNull();
  fireEvent.input(screen.getByLabelText("Code", { exact: true }), { target: { value: "000000" } });
  fireEvent.submit(screen.getByRole("button", { name: "Verify code" }).closest("form")!);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("Invalid authenticator code");
  expect(calls.mock.calls.every(([path]) => path.startsWith("/service/api/"))).toBe(true);
  expect(localStorage.length + sessionStorage.length).toBe(0);
});

it("describes SMTP delivery without claiming a public portal or successful inbox delivery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.endsWith("/health")) return reply({ ...localHealth, delivery: "smtp-queue" });
      if (path.endsWith("/me")) return reply({ error: "Sign in to continue" }, 401);
      return reply({ status: true });
    }),
  );
  render(<ServiceWorkspace />);
  await screen.findByText(/This local trial emails/);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(screen.getByText(/Open localhost links on this computer/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  fireEvent.input(screen.getByLabelText("Email address", { exact: true }), {
    target: { value: "synthetic@example.test" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Request recovery link" }).closest("form")!);
  await screen.findByText(/recovery link has been queued for email/);
  expect(screen.queryByText(/No email is sent/)).toBeNull();
  expect(localStorage.length + sessionStorage.length).toBe(0);
});
