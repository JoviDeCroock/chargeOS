// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { TroubleshootingPanel } from "../src/troubleshooting.js";

const preview = { context: { connected: false, readiness: "blocked" }, sha256: "a".repeat(64) };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function fill() {
  expect(screen.getByRole("heading", { name: "Troubleshoot with your own AI key" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review diagnostics" }));
  await screen.findByText("Diagnostics to send");
  fireEvent.input(screen.getByLabelText("Model ID"), { target: { value: "synthetic-model" } });
  fireEvent.input(screen.getByLabelText("Your API key"), {
    target: { value: "synthetic-provider-key" },
  });
  fireEvent.input(screen.getByLabelText("What needs troubleshooting?"), {
    target: { value: "Why is offline charging blocked?" },
  });
}
it("sends only after preview and consent, clears the key, and renders untrusted answers as text", async () => {
  const calls = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? {
                provider: "openai",
                model: "synthetic-model",
                advice: "<img src=x onerror=alert(1)>",
                contextSha256: preview.sha256,
                sources: [{ url: "https://example.test/manual", title: "Manual" }],
              }
            : preview,
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", calls);
  render(<TroubleshootingPanel stationId="HOME_1" token="owner-secret" />);
  expect(calls).not.toHaveBeenCalled();
  await fill();
  const submit = screen.getByRole("button", { name: "Get troubleshooting advice" });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/Allow internet searches/));
  fireEvent.click(screen.getByLabelText(/Send this question/));
  fireEvent.submit(submit.closest("form")!);
  await screen.findByText("Advice for owner review");
  expect((screen.getByLabelText("Your API key") as HTMLInputElement).value).toBe("");
  expect(document.querySelector(".ai-answer img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Manual" }).getAttribute("rel")).toContain("noreferrer");
  const post = calls.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(post[0]).toBe("/api/v1/stations/HOME_1/troubleshooting");
  expect(JSON.parse(post[1]?.body as string)).toMatchObject({
    apiKey: "synthetic-provider-key",
    contextSha256: preview.sha256,
    consent: true,
    webSearch: true,
  });
  expect(localStorage.length + sessionStorage.length).toBe(0);
});
it("revokes consent after question/search changes and recovers from a provider failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "POST"
              ? {
                  error: {
                    code: "troubleshooting_failed",
                    message: "Check model access and retry.",
                  },
                }
              : preview,
          ),
          { status: init?.method === "POST" ? 502 : 200 },
        ),
    ),
  );
  render(<TroubleshootingPanel stationId="HOME_1" token="owner-secret" />);
  await fill();
  const consent = screen.getByLabelText(/Send this question/);
  fireEvent.click(consent);
  fireEvent.input(screen.getByLabelText("What needs troubleshooting?"), {
    target: { value: "Changed question" },
  });
  expect((consent as HTMLInputElement).checked).toBe(false);
  fireEvent.click(consent);
  fireEvent.submit(
    screen.getByRole("button", { name: "Get troubleshooting advice" }).closest("form")!,
  );
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Check model access"),
  );
  expect((screen.getByLabelText("Your API key") as HTMLInputElement).value).toBe("");
  expect((consent as HTMLInputElement).checked).toBe(false);
});
