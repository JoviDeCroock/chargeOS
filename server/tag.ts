import { createHmac } from "node:crypto";

export function pseudonymizeTag(tag: string, stationSecret: string): string {
  return createHmac("sha256", stationSecret).update(tag).digest("hex").slice(0, 24);
}

/**
 * OCPP 1.6 `IdToken` is a `CiString20`: identifiers compare case-insensitively. Chargers differ in
 * the letter case they report hexadecimal card UIDs in, so fold ASCII letters only. Unicode case
 * folding is deliberately avoided because it can create unexpected equivalences.
 */
export function foldIdTag(tag: string): string {
  return tag.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
