// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/preact";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { HelpWorkspace } from "../src/help.js";

// jsdom replaces import.meta.url with a non-file URL; vitest runs from the repository root.
const guideDirectory = join(process.cwd(), "docs", "guides");
const scrollIntoView = vi.fn();
Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});
const guideIds = readdirSync(guideDirectory)
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -3));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  scrollIntoView.mockClear();
});

it("lists every plain-language guide in the in-app help navigation", () => {
  window.history.replaceState(null, "", "/help");
  render(<HelpWorkspace />);
  const navigation = screen.getByRole("navigation", { name: "Help topics" });
  const listed = within(navigation)
    .getAllByRole("link")
    .map((link) => new URL(link.getAttribute("href")!, "http://local").searchParams.get("guide"));
  expect([...listed].sort()).toEqual([...guideIds].sort());
});

it("only links guides to forms the help renderer can resolve", () => {
  for (const id of guideIds) {
    const text = readFileSync(join(guideDirectory, `${id}.md`), "utf8");
    for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
      const local = href!.match(/^([a-z-]+|README)\.md(#[a-z0-9-]+)?$/);
      const supported =
        href!.startsWith("https://") ||
        (local && guideIds.includes(local[1]!)) ||
        /^\.\.\/[a-z-]+\.md(?:#[a-z0-9-]+)?$/.test(href!);
      expect(Boolean(supported), `${id}.md links to ${href}`).toBe(true);
      if (local?.[2]) {
        window.history.replaceState(null, "", `/help?guide=${local[1]}`);
        const view = render(<HelpWorkspace />);
        expect(view.container.querySelector(local[2]), `${id}.md target ${href}`).toBeTruthy();
        view.unmount();
      }
    }
  }
});

it("opens the recovery chapter from company help with its stable heading target", () => {
  window.history.replaceState(null, "", "/help?guide=company-hosting");
  const view = render(<HelpWorkspace />),
    link = view.container.querySelector(
      'a[href="/help?guide=recovery#bring-the-reviewed-recovery-back-to-https"]',
    );
  expect(link).toBeTruthy();
  window.history.replaceState(null, "", link!.getAttribute("href")!);
  view.rerender(<HelpWorkspace />);
  expect(
    screen.getByRole("heading", { name: "Bring the reviewed recovery back to HTTPS" }).id,
  ).toBe("bring-the-reviewed-recovery-back-to-https");
  expect(scrollIntoView).toHaveBeenCalledOnce();
});

it("keeps hosted help connected to the company workspace without an owner-console link", () => {
  window.history.replaceState(null, "", "/help?guide=company-hosting");
  render(<HelpWorkspace hostedPage />);
  expect(screen.getByRole("heading", { name: "Share the company workspace" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Owner console" })).toBeNull();
  expect(screen.getByRole("link", { name: "chargeOS" }).getAttribute("href")).toBe("/service");
});
