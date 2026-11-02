import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  isCardOwnership,
  isCardUse,
  type CardOwnership,
  type CardPolicy,
  type CardUse,
} from "../shared/cards.js";
import { TAG_PSEUDONYM_PATTERN } from "../shared/directory.js";
import { configuredStations, type GatewayConfig } from "./config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";
import { pseudonymizeTag } from "./tag.js";

const POLICY_SCHEMA_VERSION = 1 as const;
const MAXIMUM_POLICY_BYTES = 2 * 1024 * 1024;

export class CardPolicyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardPolicyInputError";
  }
}

export class CardPolicyUnavailableError extends Error {
  constructor() {
    super("Card classifications could not be read; fix or remove card-policy.json and restart");
    this.name = "CardPolicyUnavailableError";
  }
}

type Stored = Map<string, Map<string, CardPolicy>>;

/** Classification of one card on one charger as it stood at a moment, from the ledger. */
export type CardPolicyAt = (
  stationId: string,
  tagPseudonym: string,
  at: string,
) => CardPolicy | null;

/** How far a charger clock may plausibly differ from the gateway clock when judging history. */
export const CARD_POLICY_CLOCK_SKEW_MS = 15 * 60_000;

/**
 * Rebuilds card classifications over time from the ledger, so reports classify a session by what
 * the card was when it was used rather than what it is now. `CardPolicyChanged` sets a
 * classification; removing the card from that charger's desired set ends it, so a card added
 * again later is unclassified until classified again. Removing or reclassifying a card therefore
 * never rewrites earlier sessions, and the history survives recovery because it is in the ledger.
 *
 * Session times come from the charger clock, ledger times from the gateway. Within
 * `CARD_POLICY_CLOCK_SKEW_MS` of a change the answer errs towards private: if the card was private
 * at any point in that window the session is private. A session shortly before a card's first
 * classification takes it (a card is classified right after it is added); one earlier than that
 * stays unclassified rather than inheriting a later decision.
 */
export function cardPolicyHistory(
  events: readonly EvidenceEvent[],
  skewMs = CARD_POLICY_CLOCK_SKEW_MS,
): CardPolicyAt {
  const changes = new Map<string, { at: number; policy: CardPolicy | null }[]>();
  const push = (stationId: string, tagPseudonym: string, at: string, policy: CardPolicy | null) => {
    const key = `${stationId}\u0000${tagPseudonym}`;
    const list = changes.get(key) ?? [];
    list.push({ at: Date.parse(at), policy });
    changes.set(key, list);
  };
  for (const event of events) {
    if (event.direction !== "system") continue;
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload || typeof payload.tagPseudonym !== "string") continue;
    if (
      event.message === "CardPolicyChanged" &&
      isCardOwnership(payload.ownership) &&
      isCardUse(payload.use)
    ) {
      push(event.stationId, payload.tagPseudonym, event.at, {
        ownership: payload.ownership,
        use: payload.use,
      });
    } else if (event.message === "OwnerTagDesiredStateChanged" && payload.action === "removed") {
      push(event.stationId, payload.tagPseudonym, event.at, null);
    }
  }
  return (stationId, tagPseudonym, at) => {
    const list = changes.get(`${stationId}\u0000${tagPseudonym}`);
    if (!list?.length) return null;
    const policyAt = (moment: number): CardPolicy | null =>
      list.findLast((change) => change.at <= moment)?.policy ?? null;
    const moment = Date.parse(at);
    if (Number.isNaN(moment)) return list.at(-1)!.policy;
    const window = [
      policyAt(moment - skewMs),
      ...list
        .filter((change) => change.at > moment - skewMs && change.at <= moment + skewMs)
        .map(({ policy }) => policy),
    ];
    const privateUse = window.find((policy) => policy?.use === "private");
    if (privateUse) return privateUse;
    const current = policyAt(moment);
    if (current || list.some((change) => change.at <= moment)) return current;
    // Nothing recorded yet: only a first classification just after counts (clock running behind).
    return list.find((change) => change.at <= moment + skewMs)?.policy ?? null;
  };
}

/**
 * Owner-set classification per charger card: who owns the card (company or personal) and whether
 * its sessions are business or private. It decides two things only: which cards an employee may
 * manage from their own page (personal cards on their own charger), and which sessions a
 * reimbursement feed may include (never private ones). It never changes what a charger accepts.
 *
 * An unreadable file fails closed: every card reads as unclassified, employees cannot manage any
 * card, the feed marks sessions unclassified, and edits are refused so the file is not overwritten.
 * Each change is audited in the ledger with the card pseudonym only.
 */
export class CardPolicyStore {
  #state: Stored;
  readonly #persist: ((state: Stored) => Promise<void>) | null;
  #tail: Promise<void> = Promise.resolve();

  private constructor(state: Stored, persist: ((state: Stored) => Promise<void>) | null) {
    this.#state = state;
    this.#persist = persist;
  }

  static async open(
    config: GatewayConfig,
    path = cardPolicyPath(config.eventLogPath),
  ): Promise<CardPolicyStore> {
    try {
      const stored = await readPolicies(path);
      return new CardPolicyStore(stored ?? new Map(), (state) => writePolicies(path, state));
    } catch {
      console.warn("Card classifications unavailable; employee card management is disabled");
      return new CardPolicyStore(new Map(), null);
    }
  }

  static memory(): CardPolicyStore {
    return new CardPolicyStore(new Map(), async () => {});
  }

  get writable(): boolean {
    return this.#persist !== null;
  }

  get(stationId: string, tagPseudonym: string): CardPolicy | null {
    return this.#state.get(stationId)?.get(tagPseudonym) ?? null;
  }

  /** Classifies cards that are currently desired on their charger. */
  set(
    config: GatewayConfig,
    evidence: EvidenceStore,
    entries: readonly { readonly stationId: string; readonly tagPseudonym: string }[],
    ownership: CardOwnership,
    use: CardUse,
  ): Promise<void> {
    if (!isCardOwnership(ownership))
      throw new CardPolicyInputError("ownership must be company or personal");
    if (!isCardUse(use)) throw new CardPolicyInputError("use must be business or private");
    return this.#mutate(async (state) => {
      for (const { stationId, tagPseudonym } of entries) {
        if (
          !TAG_PSEUDONYM_PATTERN.test(tagPseudonym) ||
          !isDesired(config, stationId, tagPseudonym)
        ) {
          throw new CardPolicyInputError("Card is not an owner card of that charger");
        }
        const cards = state.get(stationId) ?? new Map<string, CardPolicy>();
        cards.set(tagPseudonym, { ownership, use });
        state.set(stationId, cards);
      }
      return async () => {
        for (const { stationId, tagPseudonym } of entries) {
          await evidence.append(
            evidenceEvent(stationId, "system", "CardPolicyChanged", {
              ownership,
              tagPseudonym,
              use,
            }),
          );
        }
      };
    });
  }

  /** Drops classifications of cards no longer desired (data minimization after a revoke). */
  prune(config: GatewayConfig): Promise<void> {
    if (!this.writable) return Promise.resolve();
    return this.#mutate(async (state) => {
      let changed = false;
      for (const [stationId, cards] of state) {
        for (const tagPseudonym of cards.keys()) {
          if (!isDesired(config, stationId, tagPseudonym)) {
            cards.delete(tagPseudonym);
            changed = true;
          }
        }
        if (cards.size === 0) state.delete(stationId);
      }
      return changed ? async () => {} : null;
    });
  }

  #mutate(change: (state: Stored) => Promise<(() => Promise<void>) | null>): Promise<void> {
    const result = this.#tail.then(async () => {
      if (!this.#persist) throw new CardPolicyUnavailableError();
      const next: Stored = new Map([...this.#state].map(([id, cards]) => [id, new Map(cards)]));
      const after = await change(next);
      if (!after) return;
      await this.#persist(next);
      this.#state = next;
      await after();
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function cardPolicyPath(eventLogPath: string): string {
  return join(dirname(eventLogPath), "card-policy.json");
}

function isDesired(config: GatewayConfig, stationId: string, tagPseudonym: string): boolean {
  const station = configuredStations(config).find(({ id }) => id === stationId);
  if (!station) return false;
  for (const tag of station.ownerTags) {
    if (`tag_${pseudonymizeTag(tag, station.secret)}` === tagPseudonym) return true;
  }
  return false;
}

async function readPolicies(path: string): Promise<Stored | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size > MAXIMUM_POLICY_BYTES
  ) {
    throw new Error("card-policy.json is not a private regular file");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const value = JSON.parse(await file.readFile("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("schema");
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "cards,schemaVersion" ||
      record.schemaVersion !== POLICY_SCHEMA_VERSION ||
      !Array.isArray(record.cards)
    ) {
      throw new Error("schema");
    }
    const state: Stored = new Map();
    for (const candidate of record.cards) {
      const entry = candidate as Record<string, unknown>;
      if (
        !entry ||
        typeof entry !== "object" ||
        Object.keys(entry).sort().join(",") !== "ownership,stationId,tagPseudonym,use" ||
        typeof entry.stationId !== "string" ||
        typeof entry.tagPseudonym !== "string" ||
        !TAG_PSEUDONYM_PATTERN.test(entry.tagPseudonym) ||
        !isCardOwnership(entry.ownership) ||
        !isCardUse(entry.use)
      ) {
        throw new Error("schema");
      }
      const cards = state.get(entry.stationId) ?? new Map<string, CardPolicy>();
      cards.set(entry.tagPseudonym, { ownership: entry.ownership, use: entry.use });
      state.set(entry.stationId, cards);
    }
    return state;
  } finally {
    await file.close();
  }
}

async function writePolicies(path: string, state: Stored): Promise<void> {
  const cards = [...state]
    .flatMap(([stationId, entries]) =>
      [...entries].map(([tagPseudonym, policy]) => ({
        ownership: policy.ownership,
        stationId,
        tagPseudonym,
        use: policy.use,
      })),
    )
    .sort((left, right) =>
      `${left.stationId}\n${left.tagPseudonym}`.localeCompare(
        `${right.stationId}\n${right.tagPseudonym}`,
      ),
    );
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(
      `${JSON.stringify({ cards, schemaVersion: POLICY_SCHEMA_VERSION })}\n`,
      "utf8",
    );
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
