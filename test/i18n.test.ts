import { afterEach, describe, expect, it } from "vitest";

import { en } from "../src/i18n/en.js";
import { fr } from "../src/i18n/fr.js";
import { formatKwh, locale, monthLabel, t, tn } from "../src/i18n/index.js";
import { nl } from "../src/i18n/nl.js";

const CATALOGS = { fr, nl } as const;

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]!).sort();
}

describe("console translations", () => {
  afterEach(() => {
    locale.value = "en";
  });

  for (const [language, catalog] of Object.entries(CATALOGS)) {
    it(`${language} has exactly the English keys and placeholders`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
      for (const [key, english] of Object.entries(en)) {
        const translated = (catalog as Record<string, string>)[key]!;
        expect(translated.trim(), key).not.toBe("");
        expect(placeholders(translated), key).toEqual(placeholders(english));
      }
    });
  }

  it("keeps every counted message paired", () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith(".one")) expect(en).toHaveProperty(`${key.slice(0, -4)}.other`);
      if (key.endsWith(".other")) expect(en).toHaveProperty(`${key.slice(0, -6)}.one`);
    }
  });

  it("formats numbers, months and plurals for Belgian Dutch and French", () => {
    locale.value = "nl";
    expect(formatKwh(14_400)).toBe("14,4 kWh");
    expect(tn("cards.count", 1)).toBe("1 laadpas");
    expect(tn("cards.count", 3)).toBe("3 laadpassen");
    expect(monthLabel("2026-10")).toBe("oktober 2026");

    locale.value = "fr";
    expect(formatKwh(14_400)).toBe("14,4 kWh");
    // French uses the singular for zero.
    expect(tn("cards.count", 0)).toBe("0 badge");
    expect(t("cards.removeTitle", { name: "Blue fob" })).toContain("Blue fob");

    locale.value = "en";
    expect(tn("cards.count", 0)).toBe("0 cards");
  });
});
