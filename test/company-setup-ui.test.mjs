import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../deploy/company-setup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../deploy/company-setup.js", import.meta.url), "utf8");
const windows = [];
afterEach(() => windows.splice(0).forEach((w) => w.close()));
function page(token = "a".repeat(64)) {
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:9099/company#${token}`,
    runScripts: "outside-only",
  });
  windows.push(dom.window);
  return dom.window;
}
it("preserves setup authorization when switching workspaces and never silently changes a custom SMTP port", () => {
  const w = page();
  w.eval(script);
  expect(w.location.hash).toBe("");
  expect(new URL(w.document.getElementById("owner-setup").href).hash).toBe(`#${"a".repeat(64)}`);
  const security = w.document.getElementById("smtpSecurity"),
    port = w.document.getElementById("smtpPort");
  security.value = "implicit-tls";
  security.dispatchEvent(new w.Event("change"));
  expect(port.value).toBe("465");
  port.value = "2525";
  security.value = "starttls";
  security.dispatchEvent(new w.Event("change"));
  expect(port.value).toBe("2525");
  expect(w.localStorage.length + w.sessionStorage.length).toBe(0);
});
it("erases SMTP fields before awaiting setup, renders no credentials and locks a successful deployment", async () => {
  const w = page();
  let complete;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  w.fetch = fetcher;
  w.eval(script);
  const doc = w.document;
  const data = {
    name: "synthetic-company",
    companyDomain: "accounts.example.be",
    signupDomains: "example.be",
    email: "ops@example.be",
    smtpHost: "smtp.example.be",
    smtpPort: "587",
    smtpSecurity: "starttls",
    smtpUsername: "synthetic-private-username",
    smtpPassword: "synthetic-private-password",
    smtpSender: "accounts@example.be",
  };
  for (const [key, value] of Object.entries(data)) doc.getElementById(key).value = value;
  doc.getElementById("confirmed").checked = true;
  const form = doc.getElementById("company-setup"),
    button = doc.querySelector('button[value="deploy"]');
  form.dispatchEvent(
    new w.SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }),
  );
  expect(doc.getElementById("smtpPassword").value).toBe("");
  expect(doc.getElementById("smtpUsername").value).toBe("");
  expect(button.disabled).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe("/deploy/company");
  expect(fetcher.mock.calls[0][1].headers["X-Setup-Token"]).toBe("a".repeat(64));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ ...data, deploy: true });
  complete({
    ok: true,
    json: async () => ({
      status: "containers-started",
      companyUrl: "https://accounts.example.be/service",
      directory: "/private/synthetic-company",
    }),
  });
  await vi.waitFor(() => expect(doc.getElementById("result").hidden).toBe(false));
  expect(doc.getElementById("result").textContent).not.toContain(data.smtpPassword);
  expect(doc.getElementById("result").textContent).not.toContain(data.smtpUsername);
  expect(button.disabled).toBe(true);
  expect(w.localStorage.length + w.sessionStorage.length).toBe(0);
});
it("requires the original terminal nonce and leaves credentials empty after an uncertain failure", async () => {
  const invalid = page("invalid");
  invalid.eval(script);
  expect([...invalid.document.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
  const w = page();
  w.fetch = vi.fn(async () => ({
    ok: false,
    json: async () => ({ error: "Inspect the private setup folder before retrying." }),
  }));
  w.eval(script);
  const form = w.document.getElementById("company-setup");
  w.document.getElementById("smtpPassword").value = "synthetic-secret";
  form.dispatchEvent(
    new w.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: w.document.querySelector('button[value="prepare"]'),
    }),
  );
  await vi.waitFor(() => expect(w.document.getElementById("error").hidden).toBe(false));
  expect(w.document.getElementById("smtpPassword").value).toBe("");
  expect(w.document.querySelector('button[value="prepare"]').disabled).toBe(false);
});
