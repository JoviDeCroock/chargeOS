import type { EvidenceEvent, EvidenceStore } from "../../server/events.js";

/** In-memory evidence store with replay-stable transaction allocation for simulator tests. */
export class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  #authorizationRevision = 0;
  readonly #transactions = new Map<string, number>();
  #nextTransactionId = 1;

  async allocateAuthorizationRevision(_stationId: string, minimum: number): Promise<number> {
    this.#authorizationRevision = Math.max(this.#authorizationRevision + 1, minimum);
    return this.#authorizationRevision;
  }

  async recordTransactionStart(
    _stationId: string,
    fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ replayed: boolean; transactionId: number }> {
    const existing = this.#transactions.get(fingerprint);
    if (existing) return { replayed: true, transactionId: existing };
    const transactionId = this.#nextTransactionId++;
    this.#transactions.set(fingerprint, transactionId);
    this.events.push(event(transactionId));
    return { replayed: false, transactionId };
  }

  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }

  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}
