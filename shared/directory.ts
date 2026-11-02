/**
 * Owner directory: the human names an owner gives to chargers, people and RFID cards.
 *
 * The directory is presentation data only. It never grants or removes authority, never changes
 * what a charger accepts, and is never written to the evidence ledger, redacted exports, delegate
 * projections, field review packs or AI troubleshooting context. Cards are addressed only by their
 * station-scoped pseudonym; a raw RFID value never enters the directory.
 */

export const DIRECTORY_NAME_MAX_LENGTH = 80;
export const DIRECTORY_MAX_PEOPLE = 500;

export interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
}

export interface DirectoryStation {
  /** Person whose usage this charger is reported under; `null` when unassigned. */
  readonly driverPersonId: string | null;
  readonly id: string;
  readonly label: string;
  readonly site: string;
}

export interface DirectoryCard {
  /** Person who carries the card; `null` when unassigned. */
  readonly holderPersonId: string | null;
  /** Owner-chosen card name, for example "Blue key fob"; `null` when unnamed. */
  readonly name: string | null;
  readonly stationId: string;
  readonly tagPseudonym: string;
}

export interface OwnerDirectory {
  /** Cards currently in each station's desired owner-card set. */
  readonly cards: readonly DirectoryCard[];
  readonly people: readonly DirectoryPerson[];
  readonly stations: readonly DirectoryStation[];
  /** `false` when the stored names could not be read; edits are refused so nothing is lost. */
  readonly writable: boolean;
}

export interface StationProfileInput {
  readonly driverPersonId: string | null;
  readonly label: string;
  readonly site: string;
}

export interface PersonInput {
  readonly name: string;
}

export interface CardProfileInput {
  readonly holderPersonId: string | null;
  readonly name: string | null;
}

export const PERSON_ID_PATTERN = /^person_[a-f0-9]{24}$/u;
export const TAG_PSEUDONYM_PATTERN = /^tag_[a-f0-9]{24}$/u;

export class DirectoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryInputError";
  }
}

/**
 * Normalizes a display name: NFC, collapsed whitespace, 1-80 characters, and no control,
 * formatting or bidirectional-override characters that could disguise one name as another.
 */
export function normalizeDirectoryName(value: unknown, field = "name"): string {
  if (typeof value !== "string") throw new DirectoryInputError(`${field} must be text`);
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length < 1 || [...normalized].length > DIRECTORY_NAME_MAX_LENGTH) {
    throw new DirectoryInputError(
      `${field} must be 1-${DIRECTORY_NAME_MAX_LENGTH} characters after trimming`,
    );
  }
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/u.test(normalized)) {
    throw new DirectoryInputError(`${field} must not contain control or formatting characters`);
  }
  return normalized;
}
