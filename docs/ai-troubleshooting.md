# Bring-your-own-key troubleshooting

Implemented 2026-10-31 in the authenticated owner console. This optional helper explains charger diagnostics; it has no charger-command tools or financial authority. Open the **Troubleshoot with your own AI key** panel, review the diagnostic preview, choose OpenAI or Anthropic, enter a model available to your account and your API key, ask a question, and explicitly approve sending it. API and optional search usage are billed by your provider.

## Data and authority

The preview is a closed projection containing connection state, continuity readiness and inspection time, five known checks, restart requirement, counts of pending authorization changes and session conflicts. Boolean values accept only `true`, `false` or `not reported`; numeric checks accept only bounded numeric text. Unrecognized values are withheld. It excludes station identity, model/firmware strings, location, raw configuration, session details, tags, pseudonyms, evidence payloads and credentials. A SHA-256 fingerprint binds consent to this exact projection; changed diagnostics return 409 and require a new preview.

The owner's question is also sent. Keep passwords, card identifiers and personal data out of it. The helper does not automatically know the charger model; a user may supply a non-secret model/firmware name when asking for manufacturer guidance. The API rejects placing the supplied provider key inside the question. This is not a general secret detector.

The key is transient component/request state, cleared from the input as soon as it is submitted and on console/station unmount. chargeOS does not persist the key, question, answer or provider error body in its evidence ledger, application logs, browser storage or recovery bundle. A trusted deployment operator necessarily controls the server handling the request. Provider data handling still applies; OpenAI requests explicitly use `store: false`, which is not a universal zero-retention guarantee.

Only the owner bearer token can use `GET /api/v1/stations/:id/troubleshooting/preview` and `POST /api/v1/stations/:id/troubleshooting`; delegates and commercial organization sessions gain no new authority. Legacy unscoped aliases address the primary station only. The POST has a closed schema, explicit consent, an 8 KiB body ceiling, a 45-second provider timeout, a 128 KiB response ceiling, one concurrent call per edge, a five-second minimum between calls and an 1,800-token output budget. Provider errors are replaced by fixed actionable messages. Neither answers nor citations can execute HTML, JavaScript, an OCPP command or a payment.

## Optional internet search

**Allow internet searches** enables only the selected provider's hosted web-search tool. No separate search key or arbitrary MCP/browser server is required. OpenAI uses Responses `web_search` with at most three tool calls; Anthropic uses `web_search_20250305` with `max_uses: 3`. With the toggle off, no tool is supplied. A compatible model/account and provider web-search access are required. Search may incur additional charges and the model chooses whether to search.

The prompt asks for primary manufacturer sources, exact model/firmware matching and separate observations/uncertainties/next steps. Web pages and questions are untrusted input. Prompt instructions cannot guarantee correct advice; the enforceable boundary is that there are no charger, shell, configuration-write or financial tools. Returned citation URLs must be HTTPS without embedded credentials; they render as escaped, separate source links with `noopener noreferrer`. Read the source and confirm applicability before acting.

## Production transport

Development uses fixed HTTPS provider endpoints. Production keeps chargeOS on its internal-only network and uses `CHARGEOS_AI_RELAY_ORIGIN=http://caddy:9092`. The existing Caddy peer forwards only POST `/openai` to the fixed Responses endpoint and POST `/anthropic` to the fixed Messages endpoint. Port 9092 is not published; its server has no access log. Public owner/OCPP hostnames retain their existing routing, security headers and separate TLS boundaries. No caller-selected endpoint or redirect can receive the provider key. The relay does not give the internal edge general internet egress. Loss of the provider or relay removes advice only; owner charging, RFID synchronization, evidence and recovery retain their existing behavior.

## Verification and limits

The synthetic adapter and HTTP tests exercise secret minimization, numeric boolean injection, malformed provider selection, arbitrary tools/endpoints, stale consent, owner/station scoping, concurrent calls, provider errors, response bounds, both provider schemas and search/source filtering. UI tests exercise explicit consent, transient keys, escaped answers and error recovery. These tests do not establish model answer quality or live provider/model entitlement. Real provider calls require a user's key and have not been made as part of this change.

Primary API references checked 2026-10-31: [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages), [Anthropic web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
