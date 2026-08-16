import { createHmac } from "node:crypto";

export function pseudonymizeTag(tag: string, stationSecret: string): string {
  return createHmac("sha256", stationSecret).update(tag).digest("hex").slice(0, 24);
}
