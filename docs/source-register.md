# Source register

Primary sources are preferred. Original entries were verified on 2026-08-14 unless otherwise stated. The charging-service replacement entries below were checked on 2026-10-28. Current claims should be refreshed before publication or device work.

## Charging-service replacement: 2026-10-28

The canonical [feature register](product-parity.json) contains provider-specific source IDs, URLs, verification dates and limitations. “Documented” records an advertised capability; it does not establish service quality or an entitlement in every package. Unverified does not mean absent.

- [50five Belgium drivers](https://50five.com/be/nl/consumer), [subscriptions](https://50five.com/be/nl/solutions/subscription), [energy management](https://50five.com/be/nl/solutions/energy) and [business support](https://50five.com/be/nl/contact): driver/app, employer settlement, access, operational and service offerings. The driver page’s broad app start/stop claim conflicts with its restricted migrated-card FAQ; preserve that restriction until account-level verification.
- LMS [station management](https://www.lastmilesolutions.com/station-management/), [billing](https://www.lastmilesolutions.com/billing-as-a-service/), [roaming](https://www.lastmilesolutions.com/roaming-as-a-service/), [smart energy](https://www.lastmilesolutions.com/smart-energy-management/), [helpdesk](https://www.lastmilesolutions.com/24-7-helpdesk/) and [data/APIs](https://www.lastmilesolutions.com/it-data-management/): platform and operational scope. Payment/compliance and performance descriptions remain provider claims.
- LMS [branded environments](https://www.lastmilesolutions.com/branded-environments/), [payment services](https://www.lastmilesolutions.com/payment-as-a-service/) and [migration services](https://www.lastmilesolutions.com/migration-services/): ecosystem dependencies; an advertised API does not establish access for a particular customer.
- D’Ieteren [apps/portals](https://www.dieterenenergy.be/portaal-apps), [employee home charging](https://www.dieterenenergy.be/laadoplossingen-werknemers-thuis), [card activation](https://www.dieterenenergy.be/activation-card), [workplace charging](https://www.dieterenenergy.be/b2b-charging-infrastructure) and [charging-service terms](https://www.dieterenenergy.be/terms-and-conditions): driver/fleet, installation and financial scope. The terms identify LMS/Threeforce for transaction, roaming and financial infrastructure; 50five’s Belgium driver page also identifies Threeforce as its financial partner.

This research did not access a competitor’s authenticated customer portal, execute a payment, test a roaming agreement or establish charger compatibility. Financial/legal compliance claims need appropriate verification for the actual service before launch.

## Alfen Genesis

- [Alfen: connect to another back office](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01069) — simlock-free claim and supported OCPP JSON versions; does not guarantee credentials or offline settings.
- [Alfen: supported OCPP versions](https://aceservice.alfen.com/en-US/knowledgebase/article/KA-01059) — NG/AHP version distinctions.
- [Alfen: change back office on firmware 6+](https://aceservice.alfen.com/en-US/knowledgebase/article/KA-01098) — manual endpoint and `ocppCsmsUrl` path.
- [Alfen: change back office on firmware 5.8.1 or lower](https://knowledgebase-alfen.atlassian.net/wiki/spaces/SER/pages/783384577/Changing%2Bthe%2BBackoffice%2Bof%2Ba%2Bcharging%2Bstation%2Bwith%2BFW5.8.1%2Bor%2Blower) — older/SIM migration caveats.
- [Alfen: standalone operation](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01263) — configuration backup, SIM removal, known-tag offline action, whitelist, and RFID charging without a backend.
- [Alfen: ACE account](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01075), [Windows installer](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01282), [local connection](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01084), [transaction export](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01122).

## Standards and open source

- [Open Charge Alliance: OCPP downloads](https://openchargealliance.org/my-oca/ocpp/) — official current specifications, schemas, errata, and security materials.
- [OCPP 2.0.1 certification](https://openchargealliance.org/certificationocpp/certification-ocpp-2-0-1/) — local authorization, smart charging, ISO 15118, and advanced security are optional profiles; a version label is insufficient.
- [OCA migration whitepaper](https://openchargealliance.org/ocpp-info-whitepapers/migrating-charging-stations/) — migration complexity and large-fleet evidence.
- [OCA security operations guide](https://openchargealliance.org/wp-content/uploads/2026/01/ocpp_security_operations_guide-2.pdf) — operational security profiles and certificate practices.
- [CitrineOS core](https://github.com/citrineos/citrineos-core) and [architecture](https://citrineos.github.io/latest/core-concepts/architecture/) — Apache-2.0 TypeScript CSMS; broad but operationally heavy for Genesis.
- [`ocpp-rpc`](https://github.com/mikuso/ocpp-rpc) — MIT Node transport with strict OCPP schemas and security profiles 1–3.
- [SteVe](https://github.com/steve-community/steve) — mature Java OCPP 1.2/1.5/1.6 CSMS.
- [EVerest](https://github.com/EVerest/everest) — LF Energy charger-side framework; not a CSMS.
- [Home Assistant OCPP integration](https://home-assistant-ocpp.readthedocs.io/en/latest/user-guide.html), [evcc](https://docs.evcc.io/en/integrations/home-assistant/) — useful local/energy ecosystems, not owner-root migration platforms.

## Deployment tooling

- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and [service secret reference](https://docs.docker.com/reference/compose-file/services/#secrets) — file-backed secrets appear under `/run/secrets`; file-source ownership/mode remapping is not implemented because Compose uses bind mounts.
- [Docker production guidance](https://docs.docker.com/compose/how-tos/production/) — separate production Compose configuration and explicit deployment-time changes.
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [HTTPS quick start](https://caddyserver.com/docs/quick-starts/https) — hostname site blocks trigger certificate management and HTTP-to-HTTPS redirects when DNS and network prerequisites are met.
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — HTTP WebSocket upgrades are proxied automatically.
- [Caddy official container image](https://hub.docker.com/_/caddy/) and [Node official container image](https://hub.docker.com/_/node/) — exact versions and multi-platform manifest digests pinned by the current production files.
- [Anchore SBOM Action](https://github.com/anchore/sbom-action) — CI CycloneDX/SPDX generation using a pinned Syft release.

## Manufacturer evidence

- [Easee OCPP](https://developer.easee.com/docs/easee-ocpp-specification), [Zaptec Go configuration](https://docs.zaptec.com/docs/zaptec-go-ocpp16j-configuration-guide), [Smappee OCPP manual](https://www.smappee.com/uploads/Documentation/Technical-Documentation/EV/User-manual_EV-Line-OCPP1.6_EN.pdf) — cloud-mediated examples.
- [ABB Terra AC OCPP 1.6 implementation overview](https://library.e.abb.com/public/bbfbb8a0373d488f8ae82960750ab41d/ABB_Terra_AC_Charger_OCPP1.6_ImplementationOverview%20_FW1.8.32%201.pdf) and [ABB document library](https://new.abb.com/ev-charging/ev-charging-infrastructure/documents) — external-server workflow, TerraConfig permission, protocol, firmware, networking, and MID variant evidence.
- [Schneider EVlink Pro AC OCPP guide](https://ckm-content.se.com/ckmContent/sfc/servlet.shepherd/document/download/0698V00000nE3gqQAC), [current product page](https://www.se.com/uk/en/product-range/23107242-evlink-pro-ac/), and [commissioning/reset/MID FAQ](https://www.se.com/es/es/faqs/FAQ000266529/) — OCPP 1.6, commissioning, RFID, smart/MID options, and supported recovery.
- [Wallbox OCPP activation](https://support.wallbox.com/wp-content/uploads/2021/10/EN_ACTIVATION_GUIDE_OCPP.pdf), [Peblar manual](https://peblar.com/hubfs/User_manual_Peblar_ENG_R04.pdf?hsLang=en), [KEBA downloads](https://www.keba.com/en/emobility/service-support/downloads/downloads), [Mennekes AMTRON Professional manual](https://www.mennekes.org/fileadmin/products_media/medien_sge2/betriebsanleitungen/20240805/3331758_BA-IA_AMTRON-Professional____PnC_-TC-22_FW5.23.2_v01_2024-08-02.pdf), [go-e API](https://github.com/goecharger/go-eCharger-API-v2/blob/main/API_KEYS_FIRMWARE/apikeys-en.md), [Tesla Gen 3 UK manual](https://www.tesla.com/sites/default/files/support/charging/Gen_3_Wall_Connector_Manual_UK.pdf).
- [EVBox protocol specification summary](https://evbox.com/en/faq/key-specifications-2/) and [OpenEVSE ESP32 firmware](https://github.com/OpenEVSE/openevse_esp32_firmware) — limited generic EVBox protocol evidence and open local firmware/API evidence; neither proves every matrix field for a model.

## EU law and policy

- [AFIR, Regulation (EU) 2023/1804](https://eur-lex.europa.eu/eli/reg/2023/1804/oj/eng) — primarily public infrastructure, payments, and data; not a general private-backend switching right.
- [Data Act, Regulation (EU) 2023/2854](https://eur-lex.europa.eu/eli/reg/2023/2854/oj/eng) — user access/third-party sharing for readily available connected-product data; not an admin credential or firmware right.
- [EPBD, Directive (EU) 2024/1275](https://eur-lex.europa.eu/eli/dir/2024/1275/oj/eng) — scoped requirements for smart/interoperable charging and access to building-system data, including recharge-point data.
- [RED III, Directive (EU) 2023/2413](https://eur-lex.europa.eu/eli/dir/2023/2413/oj/eng) — smart-charging requirements for specified new/replaced non-public points; not backend portability.
- [Cyber Resilience Act, Regulation (EU) 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng) — commercial connected-product cybersecurity duties.
- [MID amendment, Directive (EU) 2026/706](https://eur-lex.europa.eu/eli/dir/2026/706/oj/eng) — now in force, adds harmonized EVSE measuring-system requirements; national application begins 2028 and explicitly avoids retrofitting existing stations.
- [Right to Repair, Directive (EU) 2024/1799](https://eur-lex.europa.eu/eli/dir/2024/1799/oj/eng) — Annex-limited repair right, not a general charger software-portability right.

## Market and competition

- [IEA Global EV Outlook 2026: charging](https://www.iea.org/reports/global-ev-outlook-2026/electric-vehicle-charging-chap-6-and-10) — more than 43 million private LDV charge points globally in 2025, around one-third in Europe; source for broad installed-base anchor.
- [EAFO Belgium 2025/2026 update](https://alternative-fuels-observatory.ec.europa.eu/general-information/news/belgium-ev-growth-continues-2025-2026-set-break-new-records) — approximately 450,000 EVs at end-2025 and unusually high company-car share; EV stock is not private charger stock.
- [EAFO Germany BEV fleet](https://alternative-fuels-observatory.ec.europa.eu/general-information/news/germanys-bev-fleet-surpasses-2-million-units-major-milestone) — 2,034,260 BEV passenger cars at 1 January 2026; does not measure home chargers.
- EAFO current country summaries for [France](https://alternative-fuels-observatory.ec.europa.eu/transport-mode/road/france), [Netherlands](https://alternative-fuels-observatory.ec.europa.eu/transport-mode/road/netherlands), [Sweden](https://alternative-fuels-observatory.ec.europa.eu/transport-mode/road/sweden), and [Denmark](https://alternative-fuels-observatory.ec.europa.eu/transport-mode/road/denmark) — Q2-2026 alternative-fuel light-duty context used only to weight uncertain private-point ranges; category includes more than plug-in EVs.
- [UK vehicle licensing statistics 2025](https://www.gov.uk/government/statistics/vehicle-licensing-statistics-2025/vehicle-licensing-statistics-united-kingdom-2025) — official current registration source; it does not enumerate private chargers or OCPP capability.
- [EAFO charging price overview](https://alternative-fuels-observatory.ec.europa.eu/markets-and-policy/market-and-consumer-insights/electric-vehicle-recharging-prices) — European charging context; home/work dominance appears in associated EAFO materials.
- [Transport & Environment private charging investment study](https://www.transportenvironment.org/uploads/files/202411_investment_needs_study-3.pdf) — advocacy scenario of roughly 37 million private EU chargers by 2030, not a current-stock fact.
- [Plugchoice overview](https://support.plugchoice.com/en/articles/12930254-what-is-plugchoice) and [developer proposition](https://plugchoice.com/en/solutions/developers) — close competitor offering free management, an OCPP proxy/API, and broad backend compatibility; continued dependence on its cloud must be independently verified.
- [OCA migration whitepaper](https://openchargealliance.org/ocpp-info-whitepapers/migrating-charging-stations/) — direct evidence that backend migration is a real operational category.
