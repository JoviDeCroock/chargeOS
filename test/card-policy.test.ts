import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CardPolicyInputError,
  CardPolicyStore,
  CardPolicyUnavailableError,
  cardPolicyPath,
} from "../server/card-policy.js";
import type { GatewayConfig, StationConfig } from "../server/config.js";
import { pseudonymizeTag } from "../server/tag.js";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.js";

const HOME_SECRET = "0123456789abcdef0123456789abcdef01234567";
const OFFICE_SECRET = "fedcba9876543210fedcba9876543210fedcba98";
const COMPANY_CARD = "04C0FFEE0001";
const PERSONAL_CARD = "04CAFE1234";

const pseudonym = (tag: string, secret: string) => `tag_${pseudonymizeTag(tag, secret)}`;

describe("card classifications", () => {
  let directory: string;
  let config: GatewayConfig;
  let homeTags: Set<string>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-card-policy-"));
    homeTags = new Set([COMPANY_CARD, PERSONAL_CARD]);
    const stations: StationConfig[] = [
      { id: "HOME-1", label: "Driveway", ownerTags: homeTags, secret: HOME_SECRET, site: "Home" },
      {
        id: "OFFICE-1",
        label: "Office",
        ownerTags: new Set([COMPANY_CARD]),
        secret: OFFICE_SECRET,
        site: "Office",
      },
    ];
    config = {
      apiHost: "127.0.0.1",
      apiPort: 0,
      eventLogPath: join(directory, "events.ndjson"),
      eventLogMaxBytes: 268_435_456,
      heartbeatSeconds: 60,
      ocppHost: "127.0.0.1",
      ocppMaxConnections: 8,
      ocppMaxPayloadBytes: 1_048_576,
      ocppMessageBurst: 60,
      ocppMessagesPerMinute: 600,
      ownerApiToken: "owner-token-at-least-thirty-two-characters",
      ownerTags: homeTags,
      port: 0,
      stationId: "HOME-1",
      stationSecret: HOME_SECRET,
      stations,
      trustProxyHeaders: false,
      uiDirectory: "dist/ui",
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
  });

  it("classifies only cards desired on that charger and audits pseudonyms only", async () => {
    const evidence = new MemoryEvidenceStore();
    const store = await CardPolicyStore.open(config);
    const personal = pseudonym(PERSONAL_CARD, HOME_SECRET);
    await store.set(
      config,
      evidence,
      [{ stationId: "HOME-1", tagPseudonym: personal }],
      "personal",
      "private",
    );
    expect(store.get("HOME-1", personal)).toEqual({ ownership: "personal", use: "private" });

    // The same card on another charger has another pseudonym and is not desired there.
    await expect(
      store.set(
        config,
        evidence,
        [{ stationId: "OFFICE-1", tagPseudonym: pseudonym(PERSONAL_CARD, OFFICE_SECRET) }],
        "company",
        "business",
      ),
    ).rejects.toBeInstanceOf(CardPolicyInputError);
    // A home pseudonym never addresses the office charger.
    await expect(
      store.set(
        config,
        evidence,
        [{ stationId: "OFFICE-1", tagPseudonym: personal }],
        "company",
        "business",
      ),
    ).rejects.toBeInstanceOf(CardPolicyInputError);
    await expect(
      store.set(
        config,
        evidence,
        [{ stationId: "NOWHERE", tagPseudonym: personal }],
        "company",
        "business",
      ),
    ).rejects.toBeInstanceOf(CardPolicyInputError);
    expect(() =>
      store.set(
        config,
        evidence,
        [{ stationId: "HOME-1", tagPseudonym: personal }],
        "x" as never,
        "private",
      ),
    ).toThrow(CardPolicyInputError);

    expect(evidence.events.filter(({ message }) => message === "CardPolicyChanged")).toEqual([
      expect.objectContaining({
        payload: { ownership: "personal", tagPseudonym: personal, use: "private" },
        stationId: "HOME-1",
      }),
    ]);
    const ledger = JSON.stringify(evidence.events);
    expect(ledger).not.toContain(PERSONAL_CARD);
    expect(ledger).not.toContain(COMPANY_CARD);
    const stored = await readFile(cardPolicyPath(config.eventLogPath), "utf8");
    expect(stored).not.toContain(PERSONAL_CARD);

    // Persisted: a restart reads the same classification.
    const reopened = await CardPolicyStore.open(config);
    expect(reopened.get("HOME-1", personal)).toEqual({ ownership: "personal", use: "private" });
  });

  it("forgets the classification of a card once it is no longer desired", async () => {
    const evidence = new MemoryEvidenceStore();
    const store = await CardPolicyStore.open(config);
    const personal = pseudonym(PERSONAL_CARD, HOME_SECRET);
    const company = pseudonym(COMPANY_CARD, HOME_SECRET);
    await store.set(
      config,
      evidence,
      [{ stationId: "HOME-1", tagPseudonym: personal }],
      "personal",
      "private",
    );
    await store.set(
      config,
      evidence,
      [{ stationId: "HOME-1", tagPseudonym: company }],
      "company",
      "business",
    );
    homeTags.delete(PERSONAL_CARD);
    await store.prune(config);
    expect(store.get("HOME-1", personal)).toBeNull();
    expect(store.get("HOME-1", company)).toEqual({ ownership: "company", use: "business" });
    const reopened = await CardPolicyStore.open(config);
    expect(reopened.get("HOME-1", personal)).toBeNull();
  });

  it("fails closed and read-only when the file cannot be trusted, without overwriting it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const path = cardPolicyPath(config.eventLogPath);
    const personal = pseudonym(PERSONAL_CARD, HOME_SECRET);
    const unreadable = [
      "{not json",
      JSON.stringify({ cards: [], schemaVersion: 2 }),
      JSON.stringify({
        cards: [
          {
            ownership: "personal",
            stationId: "HOME-1",
            tagPseudonym: PERSONAL_CARD,
            use: "private",
          },
        ],
        schemaVersion: 1,
      }),
    ];
    for (const content of unreadable) {
      await writeFile(path, content, { mode: 0o600 });
      const store = await CardPolicyStore.open(config);
      expect(store.writable).toBe(false);
      expect(store.get("HOME-1", personal)).toBeNull();
      await expect(
        store.set(
          config,
          new MemoryEvidenceStore(),
          [{ stationId: "HOME-1", tagPseudonym: personal }],
          "personal",
          "private",
        ),
      ).rejects.toBeInstanceOf(CardPolicyUnavailableError);
      await store.prune(config);
      expect(await readFile(path, "utf8")).toBe(content);
    }

    await writeFile(path, JSON.stringify({ cards: [], schemaVersion: 1 }), { mode: 0o600 });
    await chmod(path, 0o644);
    expect((await CardPolicyStore.open(config)).writable).toBe(false);
  });
});
