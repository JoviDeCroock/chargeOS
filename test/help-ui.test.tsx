// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/preact";
import { afterEach, expect, it } from "vitest";
import { HelpWorkspace } from "../src/help.js";

// jsdom replaces import.meta.url with a non-file URL; vitest runs from the repository root.
const guideDirectory = join(process.cwd(), "docs", "guides");
const guideIds = readdirSync(guideDirectory)
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -3));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
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
      const supported =
        href!.startsWith("https://") ||
        (/^[a-z-]+\.md$/.test(href!) && guideIds.includes(href!.slice(0, -3))) ||
        /^\.\.\/[a-z-]+\.md(?:#[a-z0-9-]+)?$/.test(href!);
      expect(supported, `${id}.md links to ${href}`).toBe(true);
    }
  }
});
