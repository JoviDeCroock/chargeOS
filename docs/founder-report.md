# Founder report: chargeOS

- Research cut-off: 2026-08-14
- Stage: pre-Genesis experiment
- Verdict: **conditional go**
- Evidence: [source register](source-register.md); estimates below are explicitly labelled

## 1. Executive verdict

Proceed for 90 days, but do not start by building a broad consumer CSMS. First liberate the privately owned Alfen, publish the evidence, and test whether owners/installers pay for a repeatable migration plus continuity guarantee.

The technical premise is real: Alfen documents [neutral OCPP backend selection](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01069) and [standalone known-RFID operation](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01263). The operational category is real: the Open Charge Alliance now publishes a [migration playbook](https://openchargealliance.org/ocpp-info-whitepapers/migrating-charging-stations/) and cites a 100,000-station migration. The generic product is not novel: [Plugchoice](https://support.plugchoice.com/en/articles/12930254-what-is-plugchoice) already offers free charger management and an OCPP proxy across many back offices.

chargeOS is differentiated only if it supplies a verified owner root: local essential use, a self-hostable edge, an independent recovery bundle, model/firmware migration evidence, scoped employer/installer/energy permissions, and a witnessed Freedom Test. Kill or pivot if the Alfen cannot pass or fewer than three of five qualified pilots pay.

## 2. Why this problem exists

Legal ownership of an EVSE does not imply administrative control. The installer or employer may retain the charger password, the CPO owns the CSMS account, a provider SIM reaches only its network, and vendor firmware may expose OCPP solely through a cloud portal. RFID and session evidence can remain inside that commercial relationship after the owner changes employer or provider.

Standards reduce protocol lock-in but do not remove product lock-in. "OCPP 1.6" does not prove an owner-selectable endpoint, a persistent local authorization list, admin credential handover, offline buffer persistence, or a supported factory recovery. [OCPP 2.0.1 certification](https://openchargealliance.org/certificationocpp/certification-ocpp-2-0-1/) even makes Local Authorization List an optional profile.

The freest hardware may already solve essential use in standalone mode; the most captive hardware may be impossible to liberate. chargeOS targets the middle: capable hardware whose supported migration is operationally difficult.

## 3. Why now

- **Installed base:** the [IEA estimates](https://www.iea.org/reports/global-ev-outlook-2026/electric-vehicle-charging-chap-6-and-10) over 43 million private light-duty charge points worldwide in 2025, around one-third in Europe (roughly 14 million).
- **Forced transitions:** Belgian fleet electrification is employer-heavy; [EAFO reports](https://alternative-fuels-observatory.ec.europa.eu/general-information/news/belgium-ev-growth-continues-2025-2026-set-break-new-records) about 450,000 Belgian EVs at end-2025 and 89% of new BEVs registered as company cars. Employment/lease changes create immediate handover jobs.
- **Migration maturity:** OCA published a current station-migration guide in late 2025; neutral OCPP software such as CitrineOS, SteVe, and `ocpp-rpc` is mature enough that framing is not the research problem.
- **Policy direction:** the [EU Data Act](https://eur-lex.europa.eu/eli/reg/2023/2854/oj/eng) applies, [EPBD](https://eur-lex.europa.eu/eli/dir/2024/1275/oj/eng) pushes scoped interoperable smart charging and recharge-point data access, and the [2026 MID amendment](https://eur-lex.europa.eu/eli/dir/2026/706/oj/eng) now covers EVSE measuring systems for future national application.
- **Competitive warning:** Plugchoice proves the proxy/management category now. The window is for a deeper continuity standard and evidence network, not another dashboard.

## 4. Exact customer

The first customer is a Belgian/Benelux homeowner who owns an OCPP-capable charger installed through an employment, lease, fleet, or reimbursement relationship that is ending or changing. They have physical/LAN access and either the local admin credential or a supported installer recovery path.

Their job is: **keep hardware I own useful, preserve meter evidence, and choose who may manage or reimburse it without replacing the charger.**

The initial economic buyer may be the installer, leasing company, employer offboarding team, or new reimbursement provider. Selling continuity at an active transition has better urgency than acquiring consumers against a hypothetical future cloud failure.

## 5. Market structure

The charge point/EVSE and firmware control electrical behavior and local storage. The CSMS terminates OCPP and manages authorization, configuration, transactions, and commands. A CPO operates chargers; an eMSP serves drivers; roaming hubs connect them. Installers commission local/backend settings. Employers, leasing companies, and reimbursement providers may control the commercial account. Energy suppliers/aggregators optimize loads. ISO 15118 Plug & Charge handles vehicle-to-EVSE certificate identity, while OCPI connects operators; neither gives the homeowner backend control.

Lock-in concentrates at four boundaries:

1. installer/admin password and factory recovery;
2. endpoint/SIM/network configuration;
3. firmware-specific optional OCPP behavior;
4. operator identity, RFID, session, meter, and reimbursement custody.

The detailed actor and standards map is [European charging stack and standards](market-and-standards.md).

## 6. Existing OSS landscape

| Project               | Architecture/maturity/license                                                                            | Decision                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ocpp-rpc`            | MIT Node transport; OCPP 1.6/2.0.1/2.1 schemas, strict validation, security profiles                     | Use for the thin TypeScript Genesis gateway                                |
| CitrineOS             | Apache-2.0 TypeScript/Fastify modular CSMS; RabbitMQ, Redis, PostgreSQL/PostGIS, object store, Hasura/UI | Reference and possible later protocol engine; too heavy for one local edge |
| SteVe                 | Mature Java OCPP 1.2/1.5/1.6 CSMS with long field history                                                | Independent interoperability fallback and operational comparator           |
| Mobility House `ocpp` | Maintained MIT Python OCPP 1.6/2.0.1 library                                                             | Independent simulator/reference                                            |
| EVerest               | Apache-2.0 LF Energy charger-side framework with OCPP/ISO 15118/energy modules                           | Open-hardware/test ally, not a CSMS                                        |
| Home Assistant OCPP   | Third-party local/home integration                                                                       | Distribution/prototyping path, not owner-root multi-tenant architecture    |
| evcc                  | Open home-energy optimizer                                                                               | Integration partner, not migration/control-plane replacement               |
| OpenEVSE              | Open EVSE firmware/hardware and local API ecosystem                                                      | Openness reference; separate electrical certification/support scope        |

Do not fork CitrineOS during Genesis. Keep a protocol-engine adapter so chargeOS can later embed, operate, or contribute upstream. Build the consumer ownership layer, migration tooling, permissions, compatibility database, energy integrations, and hosted/local UX around a replaceable engine.

## 7. Charger Freedom Matrix

The current [Freedom Matrix](charger-freedom-matrix.md) covers 16 families. Best early candidates are exact models from Alfen, Mennekes Professional, Schneider EVlink Pro AC, KEBA P30, go-e, and selected ABB/Peblar lines. Easee, Zaptec, and Smappee are important counterexamples: OCPP exists, but their cloud or permission remains in the path. Tesla residential Gen 3 has local commissioning/access control but no primary evidence of a neutral residential OCPP endpoint.

Each grade is model/hardware/firmware/country specific. Manufacturer documentation creates a provisional claim; only a real [Freedom Test](freedom-test.md) can create an A/B field grade.

The defensible dataset records endpoint path, credential/SIM dependency, local authorization, unknown-tag policy, persistence, buffer limits, metering, export, recovery, firmware, evidence date, and observed failures—not an OCPP checkbox.

## 8. Technical architecture

Use a hybrid edge-first architecture:

1. the charge point persists the owner's essential authorization;
2. an optional owner-controlled edge terminates OCPP and keeps local management alive;
3. a replaceable EU-hosted control plane supplies remote convenience, backup, and integrations.

Use TypeScript end to end, Preact for the future UI, ordinary EU containers/VMs for long-lived WebSockets, and PostgreSQL for durable domain/event data. Cloudflare may front web/API traffic, but proprietary edge state must not become canonical because self-host parity is a promise. Start without RabbitMQ, Hasura, or a separate TSDB; add them only when observed load requires them.

The owner is immutable root. Employer reads only reimbursable sessions; installer gets expiring diagnostics/configuration; energy provider gets bounded schedules/current; household gets selected access. No delegate can transfer ownership, replace endpoint, erase evidence, disable local owner auth, or update firmware without explicit owner approval.

Keep protocol frames behind stable station/connector/authorization/transaction/meter/delegation/evidence models. Tools and UI use the same typed operations and return evidence plus uncertainty. See [Architecture](architecture.md) and the two ADRs.

## 9. Offline-first design

The exact invariant is: **a previously synchronized owner credential delivers real energy after chargeOS, internet, DNS, and vendor clouds are unavailable.** Remote management, new tags, revocations, tariffs, and reimbursement may wait.

For OCPP 1.6J, discover and behaviorally prove local-list support, known-tag offline authorization, unknown-tag rejection, list persistence, and transaction/meter buffering. Desired state and station-acknowledged revision are separate. On uncertainty, send a complete list. Offline changes are pending, not successful. Replayed transactions are idempotent and raw evidence is retained without raw RFID.

Availability means a lost previously-authorized owner tag may remain usable until local action or reconnection; expose last sync and pending revocation. Full requirements for WAN, backend, DNS, week-long isolation, edge loss, company disappearance, restart, and recovery are in [Offline invariants](offline-invariants.md).

## 10. Migration architecture

The owner journey is: identify exact model/firmware → prove authority and credential custody → inspect current backend/SIM → back up configuration and transactions → prove standalone owner RFID → provision a strict new endpoint → switch OCPP → inspect capabilities → push full owner list → run online session → run Freedom Test → export continuity bundle.

Automate evidence capture, eligibility, configuration validation, OCPP verification, list synchronization, and rollback packaging. Use manufacturer APIs only when officially supported and owner-authorized. Do not scrape portals, bypass access controls, or claim a remote migration where physical/installer access is required.

The working Genesis edge now implements this as an append-only migration dossier. Twelve owner-evidenced prerequisites plus an externally hashed pre-switch device inventory gate a separately hashed target manifest and time-bounded owner authorization. The first Boot inside that window must exactly match the inventoried OCPP vendor, model, and firmware; a mismatch stops rather than silently changing identity. Any changed prerequisite invalidates consent. Post-switch protocol evidence remains unreviewed pending the physical Freedom Test. The dossier never operates vendor tooling or replaces competent-person work.

Legal/technical barriers include employer/lease terms, withheld charger passwords, provider-owned SIMs, warranty/support boundaries, required historical reimbursement data, firmware-specific settings, meter suitability, and competent-person electrical work. Unsupported migration stops; standalone is the independent Alfen rollback. See [Alfen Genesis runbook](alfen-genesis-runbook.md).

## 11. Security model

Reject unknown station identities and tags by default. Pre-provision a station through a physical/local claim; CPID alone is not ownership. OCPP 1.6 internet transport requires WSS, a unique random station secret, bounded messages/rates, and mTLS when the device reliably supports it. Keep credentials in a secret manager/encrypted edge store and rotate them without destroying local owner authorization.

Pseudonymize RFID identifiers with a tenant-scoped HMAC; never log/export raw tags. Keep owner-visible append-only audit records. Firmware updates are owner-only, vendor-signed, versioned, and outside Genesis. Preserve raw meter observations/provenance but never label them fiscal-grade without the required meter/legal flow. Encrypt continuity bundles separately from normal account access.

The threat model covers stolen RFID, station/backend impersonation, credential leakage, malicious remote starts, disruption/DoS, meter/reimbursement fraud, API abuse, compromised firmware, installer/employer abuse, and recovery theft in [Security model](security-model.md).

## 12. EU regulatory landscape

- **[Data Act](https://eur-lex.europa.eu/eli/reg/2023/2854/oj/eng):** supports user access and third-party sharing of readily available connected-product data. It does not grant admin passwords, endpoint replacement, or firmware.
- **[EPBD](https://eur-lex.europa.eu/eli/dir/2024/1275/oj/eng):** scoped building provisions support smart, interoperable, non-proprietary protocols and direct access/sharing for building-system data including recharge-point data. National transposition and building scope matter.
- **[RED III](https://eur-lex.europa.eu/eli/dir/2023/2413/oj/eng):** requires smart-charging support for specified new/replaced non-public points, not operator portability.
- **[AFIR](https://eur-lex.europa.eu/eli/reg/2023/1804/oj/eng):** primarily public infrastructure, payment, and data; not a general private switching right.
- **[Cyber Resilience Act](https://eur-lex.europa.eu/eli/reg/2024/2847/oj/eng):** commercial chargeOS distribution needs secure development, vulnerability handling, updates, and supported lifetimes.
- **[MID](https://eur-lex.europa.eu/eli/dir/2026/706/oj/eng):** Directive (EU) 2026/706 is now in force, adds EVSE measuring-system requirements, applies through national measures from October 2028, and avoids retrofit obligations on existing stations.
- **[Right to Repair](https://eur-lex.europa.eu/eli/dir/2024/1799/oj/eng):** Annex-limited; not a general EV charger software unlock.
- **GDPR:** RFID, location, household/employer relationships, and charging times may identify people. Minimize and scope them.
- **NIS2/electricity resale/Plug & Charge:** likely customer- and business-model-specific; obtain Belgian counsel before operating critical/fleet services, reselling electricity, or representing reimbursement/contract certificates.

The policy proposal is explicit owner rights to replace the CPMS/CSMS, receive local admin/recovery credentials, export configuration/data, retain essential local use, and switch without losing unrelated warranty. An open label supplies evidence but is not law.

## 13. Business model

Keep the complete essential gateway/edge/export/migration/test core open source and self-hostable. Sell convenience and verified service:

- hosted owner: €6–€8/charger/month;
- guided remote migration: €99–€199 once;
- installer/on-site migration: €299–€599 through qualified partners;
- installer workspace: €99–€299/month plus €2–€4/managed charger;
- employer/offboarding/reimbursement export API: contract pricing;
- independent Freedom lab/mark: transparent fixed fee, never payment for a grade.

Hypotheses to validate: consumer ARPU €7/month, installer blended ARPU €150–€500/month, fleet ARPU €2–€4/charger/month, consumer CAC €80–€180 direct versus €20–€60 through a transition/installer channel, annual consumer churn 8–15%, professional churn 3–8%. Direct consumer CAC is unattractive without migration revenue or long retention.

Illustrative hosted scale economics, excluding VAT, R&D, sales, and general overhead:

| Paying chargers | ARR at €7/mo | Infra/charger/mo | Support/charger/mo | Contribution margin hypothesis |
| --------------: | -----------: | ---------------: | -----------------: | -----------------------------: |
|           1,000 |         €84k |            €1.50 |              €2.50 |                         30–40% |
|          10,000 |        €840k |            €0.60 |              €1.20 |                         58–65% |
|         100,000 |        €8.4m |            €0.35 |              €0.65 |                         70–76% |
|       1,000,000 |         €84m |            €0.25 |              €0.40 |                         76–82% |

Payment/certificate/security allocations add roughly €0.50–€0.90/charger/month. These are planning assumptions. The critical COGS is migration/support labor, not WebSocket compute. A €349 assisted migration with €180 delivery cost contributes €169 before acquisition/overhead. Avoid electricity resale/payment flows initially.

## 14. Market sizing

**Sourced anchor:** the [IEA's](https://www.iea.org/reports/global-ev-outlook-2026/electric-vehicle-charging-chap-6-and-10) roughly 14 million European private LDV charge points in 2025. There is no harmonized current dataset for private charger model, backend, ownership, or OCPP portability; all country allocations below are founder-model ranges, not measured facts.

| Region                | Estimated private points | Annual additions | Backend/cloud controlled | OCPP capable | Realistically migratable |
| --------------------- | -----------------------: | ---------------: | -----------------------: | -----------: | -----------------------: |
| Belgium               |               0.35–0.60m |       0.12–0.20m |                   60–80% |       45–70% |                   15–35% |
| Benelux incl. Belgium |                 1.4–2.2m |       0.25–0.45m |                   50–75% |       40–65% |                   20–40% |
| Germany               |                 2.0–3.0m |       0.35–0.60m |                   35–60% |       20–40% |                   15–35% |
| France                |                 1.5–2.4m |       0.30–0.50m |                   35–60% |       20–40% |                   15–35% |
| UK                    |                 1.5–2.4m |       0.30–0.50m |                   40–65% |       25–45% |                   15–35% |
| Nordics               |                 2.0–3.2m |       0.35–0.60m |                   35–60% |       25–50% |                   15–35% |

Ranges are allocated from the European anchor using plug-in fleet, home-charging propensity, and current registration growth; private points can serve multiple vehicles and workplace points are mixed in. EAFO's current context includes about 450,000 Belgian EVs at end-2025, >2.03 million German BEVs at start-2026, and Q2-2026 alternative-fuel light-duty totals of 2.89 million France, 1.37 million Netherlands, 0.88 million Sweden, and 0.69 million Denmark; the latter category is broader than plug-ins and is only a weighting check.

Practical funnel from the 14m anchor:

| Filter                                       |     Low |     Base |     High |
| -------------------------------------------- | ------: | -------: | -------: |
| Residential/owner relevant                   |     60% |      70% |      80% |
| OCPP capable                                 |     20% |      32% |      45% |
| Supported endpoint/admin path                |     25% |      40% |      55% |
| Transition pain + willingness within 3 years |      8% |      14% |      20% |
| Near-term serviceable points                 | **34k** | **176k** | **554k** |

Thus the real three-year SAM is tens to low hundreds of thousands, not 14 million. A credible solo-start SOM is 2,000–10,000 paid chargers/migrations through a few installer/offboarding channels. Rebuild Belgium/Benelux bottom-up from installer/model/provider records before fundraising or publication.

## 15. Competitors

**Plugchoice is the closest product competitor.** It offers free charger management, an OCPP proxy/API, energy features, and connections across many back offices. It validates migration demand and invalidates a generic proxy pitch. Test its pricing, exports, owner rights, offline behavior, source availability, and permanent cloud dependency directly.

Other categories:

- Last Mile Solutions/50five, GreenFlux, E-Flux/Road, Monta, AMPECO, Driivz: operator/fleet CSMS, billing, and roaming; owner is not necessarily root.
- CitrineOS and SteVe: self-hostable protocol foundations without a consumer migration/continuity network.
- evcc and Home Assistant: excellent local energy UX, weaker credential custody and systematic cross-brand liberation.
- Manufacturer standalone/local modes: may solve one charger for free; cloud-mediated OCPP may prevent full sovereignty.
- Reimbursement/energy products: solve employer payment or optimization, not hardware control transfer.

Owner-first is differentiated only if independence is technically verified and recoverable, not because the account page says "owner."

## 16. Moat

Ranked defensible assets:

1. versioned model/firmware/provider migration evidence and exact field procedures;
2. installer distribution and a safe, repeatable handover workflow;
3. open automated Freedom Test plus trusted signed results;
4. owner-root governance, continuity covenant, and deployable recovery bundle;
5. cross-vendor energy/reimbursement integrations and operational data;
6. OCPP server code.

Keep the test and core data schema open so chargeOS does not recreate lock-in. Defensibility comes from evidence quality, review history, field network, migration tooling, support outcomes, and trusted brand. Energy optimization becomes meaningful only after distribution; it is not the initial moat.

## 17. Biggest reasons this could fail

1. Installer passwords, portals, contracts, and provider SIMs make migration rare or expensive.
2. Owners agree philosophically but will not pay outside a forced transition.
3. Plugchoice or an incumbent adds open local continuity and exports.
4. Firmware/network/provider support combinations overwhelm subscription margin.
5. Manufacturer standalone mode solves the customer need without chargeOS.
6. Reimbursement/metrology rules prevent independent employer flows.
7. A credential, remote-start, meter, or household-data incident destroys trust.
8. Paid certification appears conflicted.
9. The local edge becomes another failure-prone appliance.
10. The freest chargers need chargeOS least while the locked ones cannot be migrated.

Track credential acquisition rate, migration success, labor hours, support tickets, paid conversion, 90-day retention, offline-test failures, and restore success by exact model/firmware.

## 18. What not to build

In the first 90 days do not build a mobile app, payment processor, electricity resale, roaming/eMSP, broad fleet billing, ISO 15118 PKI, OCPP 2.1/V2G, automated firmware distribution, 15-brand production support, AI chat, or a proprietary cloud-only database. Do not fork CitrineOS or build OCPP framing. Do not market certification before two independent devices can reproduce it.

Build only what proves the owner invariant and demand: evidence capture, strict OCPP 1.6J gateway, local authorization sync, session/meter persistence, continuity export/restore, exact migration runbook, and a minimal owner/installer view after the real charger works.

## 19. 90-day execution plan

### Days 0–14: readiness

- confirm Alfen ownership, contract, exact model/firmware, password, ACE account, SIM/network, and installer;
- back up configuration and transactions and prove standalone local RFID;
- have an independent operator drill complete schema-3 restore, stopped-edge archive rollover, and custody-linked schema-4 compacted replacement recovery, including fresh proxy/DNS/certificate validation;
- publish the first create-only `linux/amd64` container tag, independently verify its immutable GitHub/Sigstore provenance and CycloneDX attestation, and deploy that digest through the recovery-backed update runbook;
- recruit one Belgian installer and schedule safe rollback.

### Days 15–30: liberation

- connect the Alfen to owner-controlled OCPP 1.6J;
- record boot/status/auth/start/meter/stop;
- inspect/push owner local authorization;
- test WAN, backend, edge, restart, unknown tag, replay, and rollback;
- publish the redacted first Freedom record.

### Days 31–60: repeatability and payment

- interview ten owners at real transitions and five installers/employer actors;
- secure three paid/signed pilots;
- repeat on a second Alfen firmware and one non-Alfen candidate;
- measure credential acquisition, labor, failures, and support;
- independently restore a local edge from the continuity bundle.

### Days 61–90: choose the company

- complete five migrations with at least three paid;
- keep median remote migration labor below 90 minutes or show a credible path;
- recruit two repeat installers;
- choose the wedge: consumer continuity, installer migration tooling, employer offboarding, or Freedom evidence/certification.

## 20. Exact first experiment with the Alfen charger

1. Record ownership/contract, exact label/platform/firmware, CPID, current backend, network/SIM owner, charger password, ACE account, and Windows/local Ethernet access.
2. Export `.exml` configuration and `.csv` transactions; checksum and copy off-device.
3. Add owner RFID and prove Alfen's standalone known-tag behavior, unknown-tag rejection, and persistence after restart. Stop if it fails.
4. Start the strict chargeOS OCPP 1.6J gateway on an isolated LAN; pre-provision exact CPID and unique secret.
5. In ACE manual backend settings, select OCPP 1.6 and set `ocppCsmsUrl`; older firmware/SIM paths use the exact Alfen procedure and competent de-energized physical work.
6. Accept `BootNotification`; record `StatusNotification` and heartbeat.
7. call `GetConfiguration` for local-list/cache/offline unknown-tag/buffer capabilities; change only documented writable keys.
8. push a full owner `SendLocalList` revision and verify acknowledgement.
9. run real online `Authorize` → `StartTransaction` → `MeterValues` → `StopTransaction`; persist once.
10. disconnect WAN/backend without cutting mains; start/complete a real owner-RFID charge and reject unknown RFID.
11. restart the station while isolated; repeat owner energy delivery. Power off the optional edge and repeat.
12. reconnect; prove buffered replay/deduplication, then restore standalone from the saved configuration as the independent rollback.
13. deliver a redacted Freedom record and encrypted continuity bundle to the owner.

No enclosure, wiring, or SIM work occurs energized or without a competent person. The canonical checklist is [Alfen Genesis runbook](alfen-genesis-runbook.md).

## 21. Go / no-go recommendation

**Go to the experiment; do not yet scale the company.**

Go if the Alfen passes the complete Freedom Test/rollback, three of five pilots pay, two installers want to repeat, an independent person restores from the continuity bundle, and support labor fits the economics.

Pivot to installer/offboarding tooling if owners reject subscriptions but transition actors pay. Pivot to an open evidence/certification network if full independence is rare but compatibility data attracts manufacturers/installers.

No-go if owner authorization does not persist through isolation/restart, supported admin access is not repeatably obtainable, free standalone/vendor options eliminate willingness to pay, support/security liability dominates revenue, or the remaining product is an undifferentiated OCPP proxy.
