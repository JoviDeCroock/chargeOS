# Local session import and reimbursement observation

Implemented 2026-10-28. Open `/observe` with `pnpm dev:web`, or from the product preview’s local-export link. This is a functional browser-only analysis tool, separate from the fictional product preview and authenticated owner console.

## Boundary

The tool reads a file chosen by the user into browser memory. It does not upload source bytes, query ThreeForce, contact a charger, modify the OCPP connection, send messages, persist records in browser storage or execute payments. Reload or **Clear local analysis** removes the working analysis. Only the user’s explicit download produces a new JSON file. Keep the original CSV separately; the draft export is not a backup of it.

No original charger configuration, source export, provider statement or bank record is changed. The tool cannot approve an employer policy, issue an invoice, authenticate a statement or prove a settlement. Expected amounts are observations under declared assumptions.

## Input contract

- UTF-8 CSV, with an optional BOM, comma or semicolon separator, RFC-style quoted fields, doubled quotes and embedded quoted line breaks.
- At most 4 MiB, 20,000 data records and 128 columns. Duplicate/empty headings, binary data and malformed quotation are rejected.
- Explicit column mappings for session ID, station ID, start, end and energy; choose Wh/kWh and the energy decimal separator. Grouping and exponent notation are rejected. The tool never guesses that a comma is grouping versus a decimal separator.
- Use an employee alias column, or explicitly assign a non-secret alias to every imported record. Do not map a raw card, RFID or token value as an employee alias. Common raw-card column names are rejected for that mapping. Unselected source columns are absent from the exported analysis.
- IDs are bounded non-secret identifiers. Timestamps include seconds and `Z` or an explicit UTC offset. Invalid calendar dates, local/ambiguous times, non-increasing sessions and negative/imprecise energy become row issues rather than silently corrected inputs.
- CSV record numbers include blank records; a quoted newline does not create another CSV record.

Canonical headings are `session_id,station_id,driver_alias,started_at,ended_at,energy_kwh`. Other headings can be mapped explicitly. This is not a claimed universal Alfen/LMS adapter: vendor-specific local dates, identifiers, units and export formats need an explicit adapter and actual authorized sample evidence. There is no automatic equivalence between IDs assigned by two different providers.

## Source provenance

SHA-256 is calculated over the actual file bytes before decoding or mapping. Every normalized session and invalid-record issue retains the source hash and logical CSV record number. The draft preserves selected column mappings, explicit units/decimal separator and declared driver assignment.

The digest links to the owner-held original bytes. It is not proof of who supplied them, their completeness, truth, meter suitability or commercial acceptance. No raw unselected columns or source filename/path are included in the downloadable draft. Source records are never appended to the charger’s canonical event ledger by this tool.

## Deterministic policy and calculations

The user supplies a policy ID/version, eligible employee alias, assigned station, effective start/end and explicit EUR/kWh rate. Switching from the fictional example to a local file clears the sample policy and rate; no regional/tax rate is inferred. Rate and comparison-amount inputs use a dot decimal separator.

Energy is integer Wh, the rate is integer micro-EUR/kWh, and arithmetic uses `bigint`. Round half-up once per included session to integer cents, then sum those cents. Rates accept up to six fractional digits; kWh accepts up to three. Unsafe integer ranges fail instead of losing precision.

- **Included:** matches the declared employee/station and fits wholly inside the policy interval; this is not independent eligibility approval.
- **Duplicate:** exact repeated station/session evidence adds no energy or amount.
- **Held:** conflicting versions of the same station/session identity hold every version; zero energy and policy-boundary crossings also remain outside totals.
- **Excluded:** outside the declared employee/station assignment or wholly outside the policy period.
- **Invalid source record:** malformed input remains an issue with source provenance; it never silently becomes a zero-value approved session.

Changing a source, mapping or policy invalidates the prior draft and comparison immediately. Async file reads cannot replace a newer selection or repopulate a cleared analysis.

## Declared-amount comparison and export

An optional user-entered statement/payment amount is compared with the expected draft total. A difference needs investigation. An equal amount with held/invalid records is explicitly labelled incomplete. Equality never means Paid or bank-confirmed.

The downloadable schema-1 `reimbursement-observation` has authority `unapproved-local-analysis`; it contains the policy, sources/mappings, decisions, issues, totals and optional `user-declared-amount-only` comparison. It is not a payment instruction, approved statement, invoice, signed financial record or settlement receipt.

The financial model still needs authentic employee/policy approval, effective-dated assignment across multiple people, durable statements/corrections, actual provider/statement imports, bank-confirmed settlement, partner execution and a transactional authorization boundary. A local draft does not satisfy those parity requirements.

## Verification

The financial/import tests check independent expected cent values, half-cent rounding, duplicate/conflicting evidence, employee/policy boundaries, DST offsets, malformed rows, record provenance, unselected card-data omission, source mismatch and resource limits. UI tests check draft invalidation, explicit comparison uncertainty and removal of a sample rate when a local file is selected.

The Chrome walkthrough exercises example import, mapping, calculation, evidence download, held/duplicate counts, amount comparison, changed-policy invalidation, file selection/reset, phone overflow and absence of upload requests. Test files are synthetic; no actual provider records or customer payments have been validated.
