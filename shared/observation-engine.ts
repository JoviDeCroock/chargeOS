import type {
  DeclaredAmountComparison,
  ObservationCsv,
  ObservationImport,
  ObservationPolicy,
  ObservationPolicyInput,
  ObservationSession,
  ObservationSource,
  ReimbursementObservation,
  SessionColumnMapping,
} from "./observation.js";

export const OBSERVATION_MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 20_000;
const MAX_COLUMNS = 128;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;

export class ObservationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservationInputError";
  }
}

export async function fingerprintObservationSource(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength > OBSERVATION_MAX_BYTES)
    throw new ObservationInputError("Choose a non-empty CSV no larger than 4 MiB.");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseObservationCsv(text: string, delimiter?: "," | ";"): ObservationCsv {
  if (new TextEncoder().encode(text).byteLength > OBSERVATION_MAX_BYTES || text.includes("\0"))
    throw new ObservationInputError("CSV is too large or contains unsupported binary data.");
  const input = text.replace(/^\uFEFF/, "");
  const selectedDelimiter = delimiter ?? detectDelimiter(input);
  const records: { recordNumber: number; cells: string[] }[] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closedQuote = false,
    recordNumber = 1;
  function pushField() {
    row.push(field);
    field = "";
    closedQuote = false;
    if (row.length > MAX_COLUMNS) throw new ObservationInputError("CSV has more than 128 columns.");
  }
  function pushRow() {
    pushField();
    if (row.some((value) => value.trim() !== "")) records.push({ recordNumber, cells: row });
    recordNumber++;
    row = [];
    if (records.length > MAX_RECORDS + 1)
      throw new ObservationInputError("CSV has more than 20,000 data records.");
  }
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += char;
      continue;
    }
    if (char === selectedDelimiter) {
      pushField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && input[index + 1] === "\n") index++;
      continue;
    }
    if (closedQuote) {
      if (char === " " || char === "\t") continue;
      throw new ObservationInputError("Unexpected characters after a quoted CSV field.");
    }
    if (char === '"') {
      if (field.length !== 0) throw new ObservationInputError("A CSV quote must start a field.");
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new ObservationInputError("CSV contains an unterminated quoted field.");
  if (field.length || row.length || closedQuote) pushRow();
  const headers = records.shift()?.cells.map((value) => value.trim());
  if (
    !headers?.length ||
    headers.some((value) => !value) ||
    new Set(headers.map((value) => value.toLowerCase())).size !== headers.length
  )
    throw new ObservationInputError("CSV needs non-empty, unique column headings.");
  if (records.length === 0) throw new ObservationInputError("CSV has no data records.");
  return { headers, delimiter: selectedDelimiter, rows: records };
}

export function mapObservationSessions(
  csv: ObservationCsv,
  mapping: SessionColumnMapping,
  source: ObservationSource,
  declaredDriverAlias: string,
): ObservationImport {
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || source.format !== "csv" || source.label.length > 120)
    throw new ObservationInputError("Source evidence is invalid.");
  if (mapping.energyUnit !== "Wh" && mapping.energyUnit !== "kWh")
    throw new ObservationInputError("Choose Wh or kWh explicitly.");
  if (mapping.decimalSeparator !== "." && mapping.decimalSeparator !== ",")
    throw new ObservationInputError("Choose the CSV decimal separator explicitly.");
  if (mapping.driverAlias && /card|rfid|tag|token|badge|pasnummer/i.test(mapping.driverAlias))
    throw new ObservationInputError(
      "Use a non-secret employee alias column, not a card, RFID or token column.",
    );
  const selected = [
    mapping.sessionId,
    mapping.stationId,
    mapping.startedAt,
    mapping.endedAt,
    mapping.energy,
    ...(mapping.driverAlias ? [mapping.driverAlias] : []),
  ];
  if (
    selected.some((heading) => !csv.headers.includes(heading)) ||
    new Set(selected).size !== selected.length
  )
    throw new ObservationInputError("Map each required field to a different existing column.");
  if (!mapping.driverAlias) identifier(declaredDriverAlias, "Declared driver alias");
  if (selected.some((heading) => /rfid|card|tag|token|badge|pasnummer|kaartnummer/i.test(heading)))
    throw new ObservationInputError(
      "Use non-secret session and employee aliases, not raw card, RFID or token columns.",
    );
  const indexes = new Map(csv.headers.map((heading, index) => [heading, index]));
  const sessions: ObservationSession[] = [],
    issues: ObservationImport["issues"][number][] = [];
  for (const row of csv.rows) {
    try {
      if (row.cells.length !== csv.headers.length)
        throw new ObservationInputError("Record has a different column count from the header.");
      const read = (heading: string) => row.cells[indexes.get(heading)!]!.trim();
      const started = read(mapping.startedAt),
        ended = read(mapping.endedAt);
      const startTime = zonedTimestamp(started),
        endTime = zonedTimestamp(ended);
      if (endTime <= startTime)
        throw new ObservationInputError("Session end must be after its start.");
      const energyWh = decimalInteger(
        read(mapping.energy),
        mapping.energyUnit === "kWh" ? 3 : 0,
        "Energy",
        mapping.decimalSeparator,
      );
      sessions.push({
        sessionId: identifier(read(mapping.sessionId), "Session ID"),
        stationId: identifier(read(mapping.stationId), "Station ID"),
        driverAlias: identifier(
          mapping.driverAlias ? read(mapping.driverAlias) : declaredDriverAlias,
          "Driver alias",
        ),
        driverAssignment: mapping.driverAlias ? "mapped-alias" : "declared-for-import",
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date(endTime).toISOString(),
        energyWh,
        sourceSha256: source.sha256,
        sourceRecord: row.recordNumber,
      });
    } catch (error) {
      if (!(error instanceof ObservationInputError)) throw error;
      issues.push({
        sourceSha256: source.sha256,
        sourceRecord: row.recordNumber,
        code: "invalid-source-record",
        message: error.message,
      });
    }
  }
  return {
    source,
    mapping,
    declaredDriverAlias: mapping.driverAlias ? null : declaredDriverAlias,
    sessions,
    issues,
  };
}

export function calculateReimbursementObservation(
  imports: readonly ObservationImport[],
  input: ObservationPolicyInput,
): ReimbursementObservation {
  if (imports.length === 0) throw new ObservationInputError("Import at least one session source.");
  const policy = normalizeObservationPolicy(input);
  for (const item of imports) {
    if (
      !/^[a-f0-9]{64}$/.test(item.source.sha256) ||
      item.sessions.some((session) => session.sourceSha256 !== item.source.sha256)
    )
      throw new ObservationInputError("Session source evidence does not match its import.");
  }
  const from = zonedTimestamp(policy.effectiveFrom),
    until = zonedTimestamp(policy.effectiveUntil);
  const all = imports.flatMap((item) => item.sessions);
  if (all.length > MAX_RECORDS)
    throw new ObservationInputError("Analysis is limited to 20,000 session records.");
  const fingerprints = new Map<string, Set<string>>();
  for (const session of all) {
    validateNormalizedSession(session);
    const key = sessionKey(session);
    const versions = fingerprints.get(key) ?? new Set<string>();
    versions.add(sessionFingerprint(session));
    fingerprints.set(key, versions);
  }
  const seen = new Set<string>();
  const counts = { included: 0, held: 0, duplicate: 0, excluded: 0 };
  let expectedAmountCents = 0,
    includedEnergyWh = 0;
  const decisions = all.map((session) => {
    const key = sessionKey(session),
      start = zonedTimestamp(session.startedAt),
      end = zonedTimestamp(session.endedAt);
    let status: keyof typeof counts = "included",
      reason = "Matches the declared driver, station and policy period.",
      amountCents = 0;
    if (fingerprints.get(key)!.size > 1) {
      status = "held";
      reason = "Conflicting versions of the same station/session identity; all versions are held.";
    } else if (seen.has(key)) {
      status = "duplicate";
      reason = "Exact repeated station/session record; excluded from energy and amount totals.";
    } else if (
      session.driverAlias !== policy.driverAlias ||
      session.stationId !== policy.stationId
    ) {
      status = "excluded";
      reason = "Outside the declared employee/station assignment.";
    } else if (end <= from || start >= until) {
      status = "excluded";
      reason = "Outside this policy period.";
    } else if (start < from || end > until) {
      status = "held";
      reason = "Crosses a policy boundary; do not assign the whole session to one rate.";
    } else if (session.energyWh === 0) {
      status = "held";
      reason = "Zero-energy record needs review.";
    } else {
      amountCents = roundSessionCents(session.energyWh, policy.rateMicroEurPerKwh);
      expectedAmountCents = safeInteger(
        BigInt(expectedAmountCents) + BigInt(amountCents),
        "Statement amount",
      );
      includedEnergyWh = safeInteger(
        BigInt(includedEnergyWh) + BigInt(session.energyWh),
        "Statement energy",
      );
    }
    seen.add(key);
    counts[status]++;
    return { session, status, reason, amountCents };
  });
  const sources = imports
    .map((item) => item.source)
    .filter(
      (source, index, list) => list.findIndex((item) => item.sha256 === source.sha256) === index,
    );
  const sourceMappings = imports.map((item) => ({
    sha256: item.source.sha256,
    mapping: item.mapping,
    declaredDriverAlias: item.declaredDriverAlias,
  }));
  return {
    schemaVersion: 1,
    kind: "reimbursement-observation",
    authority: "unapproved-local-analysis",
    policy,
    sources,
    sourceMappings,
    decisions,
    issues: imports.flatMap((item) => item.issues),
    includedEnergyWh,
    expectedAmountCents,
    counts,
  };
}

export function compareDeclaredAmount(
  observation: ReimbursementObservation,
  amountEur: string,
  decimalSeparator: "." | "," = ".",
): DeclaredAmountComparison {
  const reportedAmountCents = decimalInteger(amountEur, 2, "Reported EUR amount", decimalSeparator);
  const differenceCents = observation.expectedAmountCents - reportedAmountCents;
  const outcome =
    differenceCents !== 0
      ? "difference-to-investigate"
      : observation.counts.held || observation.issues.length
        ? "matches-known-amount-with-unresolved-records"
        : "matches-declared-amount";
  return { authority: "user-declared-amount-only", reportedAmountCents, differenceCents, outcome };
}

export function normalizeObservationPolicy(input: ObservationPolicyInput): ObservationPolicy {
  identifier(input.policyId, "Policy ID");
  identifier(input.version, "Policy version");
  identifier(input.driverAlias, "Driver alias");
  identifier(input.stationId, "Station ID");
  const from = zonedTimestamp(input.effectiveFrom),
    until = zonedTimestamp(input.effectiveUntil);
  if (until <= from) throw new ObservationInputError("Policy end must be after its start.");
  const rateMicroEurPerKwh = decimalInteger(input.rateEurPerKwh, 6, "EUR per kWh rate");
  if (rateMicroEurPerKwh === 0)
    throw new ObservationInputError("Use a positive explicit rate for this observation.");
  return {
    ...input,
    effectiveFrom: new Date(from).toISOString(),
    effectiveUntil: new Date(until).toISOString(),
    rateMicroEurPerKwh,
    currency: "EUR",
    rounding: "per-session-half-up-to-cent",
  };
}

function validateNormalizedSession(session: ObservationSession) {
  identifier(session.sessionId, "Session ID");
  identifier(session.stationId, "Station ID");
  identifier(session.driverAlias, "Driver alias");
  if (
    !Number.isSafeInteger(session.energyWh) ||
    session.energyWh < 0 ||
    !Number.isSafeInteger(session.sourceRecord) ||
    session.sourceRecord < 2 ||
    !/^[a-f0-9]{64}$/.test(session.sourceSha256)
  )
    throw new ObservationInputError("Normalized source evidence or energy is invalid.");
  if (zonedTimestamp(session.endedAt) <= zonedTimestamp(session.startedAt))
    throw new ObservationInputError("Session end must be after its start.");
}

function roundSessionCents(wh: number, rateMicro: number): number {
  // 1 kWh = 1,000 Wh; 1 cent = 10,000 micro-EUR. Round only once, per session.
  const numerator = BigInt(wh) * BigInt(rateMicro),
    divisor = 10_000_000n;
  return safeInteger((numerator + divisor / 2n) / divisor, "Session amount");
}

function decimalInteger(
  value: string,
  places: number,
  name: string,
  separator: "." | "," = ".",
): number {
  const raw = value.trim();
  const mark = separator === "." ? "\\." : ",";
  const pattern = places ? new RegExp(`^\\d+(?:${mark}\\d{1,${places}})?$`) : /^\d+$/;
  if (!pattern.test(raw))
    throw new ObservationInputError(
      `${name} must be a non-negative plain decimal with at most ${places} fractional digits; use '${separator}' as the decimal separator, with no grouping or exponent notation.`,
    );
  const normalized = separator === "," ? raw.replace(",", ".") : raw;
  const [whole, fraction = ""] = normalized.split(".");
  if (whole!.length > 16)
    throw new ObservationInputError(`${name} exceeds the supported exact range.`);
  return safeInteger(
    BigInt(whole!) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0") || "0"),
    name,
  );
}

function safeInteger(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n)
    throw new ObservationInputError(`${name} exceeds the supported exact range.`);
  return Number(value);
}

function identifier(value: string, name: string): string {
  if (!IDENTIFIER.test(value))
    throw new ObservationInputError(
      `${name} must be a 1–96 character non-secret identifier using letters, numbers, dot, underscore, colon or hyphen.`,
    );
  return value;
}

function zonedTimestamp(value: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match)
    throw new ObservationInputError(
      "Use a complete ISO timestamp with seconds and Z or an explicit UTC offset; local times are ambiguous.",
    );
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    Number(match[8] ?? 0) > 14 ||
    Number(match[9] ?? 0) > 59 ||
    (Number(match[8] ?? 0) === 14 && Number(match[9] ?? 0) !== 0)
  )
    throw new ObservationInputError(
      "Timestamp contains an invalid calendar date, time or UTC offset.",
    );
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new ObservationInputError("Timestamp could not be interpreted exactly.");
  return timestamp;
}

function sessionKey(session: ObservationSession): string {
  return JSON.stringify([session.stationId, session.sessionId]);
}
function sessionFingerprint(session: ObservationSession): string {
  return JSON.stringify([
    session.stationId,
    session.sessionId,
    session.driverAlias,
    session.startedAt,
    session.endedAt,
    session.energyWh,
  ]);
}
function detectDelimiter(input: string): "," | ";" {
  let quoted = false,
    commas = 0,
    semicolons = 0;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "\n" || char === "\r") break;
      if (char === ",") commas++;
      if (char === ";") semicolons++;
    }
  }
  return semicolons > commas ? ";" : ",";
}
