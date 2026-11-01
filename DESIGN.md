# Interface design reference

Scope: every browser surface shares one identity: the owner console at `/`, the help guides at `/help`, the `/service` account workspace with its `/service/recovery` extension, the fictional product preview at `/preview` and the local observation tool at `/observe`. This reference records shipped code.

## Owner console

Source: `src/style.css`, `src/app.tsx`, `src/troubleshooting.css`.

Direction: frosted glass over soft colour fields, light by default with a token-for-token dark theme through `prefers-color-scheme`. Glass surfaces use a translucent fill, a bright one-pixel edge and a soft shadow. Only sticky chrome that content scrolls beneath (`.glass-chrome`: the console rail and status bar, the help header and topic rail, the account top bar) adds `backdrop-filter` blur; content panels stay unblurred because the backdrop field is already soft and stacked backdrop filters under a sticky bar render a dark halo. `prefers-reduced-transparency` and browsers without backdrop filters fall back to opaque surfaces, and `prefers-reduced-motion` removes animation. Type uses the platform system stack (SF Pro, Segoe UI Variable, system-ui) with tight display tracking and tabular numerals. Monospace is reserved for real identifiers: pseudonyms, hashes, charge-point IDs and observed configuration values. No web fonts, external images, scripts or icon sets are loaded, so the console renders identically on an offline edge.

Palette (light): ground `#e3e9ed`, ink `#0f1f2b`, primary "current" teal `#0a6b73`, halo `#12b8a3`, ok `#11845a`, warn `#9a5a00`, risk `#bb3527`, live `#0b7f99`. The backdrop uses three blurred fields: teal, periwinkle and sand. Signal colours carry meaning only: green for passed/synchronized, amber for pending, red for stop conditions and destructive actions, blue-teal for live charging.

Hierarchy: a glass sidebar navigates hash-addressed pages (`#/overview`, `#/charging`, `#/cards`, `#/migration`, `#/freedom`, `#/delegates`, `#/evidence`, `#/assist`, plus `#/fleet` with several chargers). Navigation dots and badges flag pending or failed state per page. A sticky status bar names the charger and its connection. The Overview answers "can I charge without the cloud?" first, then shows At a glance, Station and the Genesis plan. The readiness halo is the single expressive element: a ring echoing a wall charger's status LED, drawn once on load with one segment per capability check. Genesis actions feature the first action, list three more and fold the rest; the six Genesis phases render as an ordered track because they are a real sequence. Typed confirmation phrases sit in a red-edged selectable block. Destructive buttons stay red; every disabled button is neutral grey.

Shape: radius encodes level (28 px hero/rail, 20 px panels, 14 px inner rows, 10–12 px controls, pills fully round). Rows inside panels are separated by hairlines rather than nested cards. Controls are at least 36 px, primary actions 44 px, with a visible focus ring.

Scoping: `src/style.css` loads on every route and owns the tokens, the shared backdrop field and the `BrandMark` styles. Console element selectors are wrapped in `:where(.console-backdrop)` and the console base font size is set on its root, so other surfaces take only the tokens and backdrop.

Verified on the synthetic simulator at 1440×900 and 390×844 in light and dark: no horizontal overflow, keyboard skip link, `aria-current` on the active page and step. Rendered checks use synthetic credentials only and are not device evidence.

## Shared identity

Source: `src/brand.tsx`, `src/style.css` (tokens, `.console-backdrop, .help-root, .cs-root, .product-shell` backdrop), `src/help.css`, `src/service/*.css`, `src/product/style.css`, `src/observation/style.css`.

Every surface opens with the same `BrandMark`: an inline SVG status ring around a bolt beside the word chargeOS, with no external asset. Every surface sits on the same backdrop field and reads colours, radii and fonts only from the shared tokens, so the dark theme follows automatically; the only literal colours left are shadows and the preview dialog scrim. Labels are sentence case with no tracked capitals. The observation tool's numbered steps keep their numbers because they are a real sequence. The `DEMO · 0028` print on the illustrated preview RFID card stays as card artwork.

- Help: a sticky glass pill header and a sticky glass topic rail beside a glass reading panel capped at 72 characters. At 860 px and below the rail becomes a horizontally scrolling strip; at 520 px the "Help" label is dropped from the header.
- Account workspace and recovery: a sticky glass pill top bar matching the help header, glass cards at the 20 px panel radius, pill buttons, tokenized fields and pill status tags. Secondary copy uses the secondary ink token. Money totals use the display face with tabular numerals.
- Product preview and observation: the preview banner is a quiet tinted strip rather than a solid fill; the sidebar, metric tiles, panels and feature cards use the glass fill, edge and shadow at the 20 px radius.

Verified in light and dark at 1280×800 and at 390×844 with no document-level horizontal overflow (the help topic strip and preview navigation scroll on purpose). The signed-in account view was checked with a synthetic `example.test` account on the local operator outbox. These rendered checks are interface evidence only.

## Account workspace

Forms use explicit labels, controls at least 44 pixels high, a visible focus ring, restrained rounded borders and generous separation between tasks. Body copy explains pending, failed and completed states without equating a software result with physical or financial authority.

The recovery extension keeps this language. Its main column is at most 740 pixels, form surface 600 pixels and phone layout remains fluid. The task heading has no eyebrow label. Setup keys are actual data in selectable wrapped code text; backup codes use two columns. No external imagery, fonts, scripts, analytics or new icon system is introduced. Private material is cleared on success/sign-out/user change; no persistent browser storage is used.

Source references: `src/service/style.css`, `src/service/recovery.css`, `src/service/recovery.tsx`. Direction and verification notes live in [the recovery surface brief](docs/design/recovery-enrollment.md).

Account delivery copy uses the typed service health mode. Operator-only mode explains private local links; SMTP mode explains queued email and localhost trial limits without promising inbox delivery or a public portal. Existing labels, controls and layout are retained; the decorative heading eyebrow is removed. No new visual assets or persistent browser state are introduced.

Scoped finish review: the rendered account and recovery-entry guidance preserves the account workspace at 1280 and 390 pixels with no horizontal overflow. The new email guide is reachable in `/help` and fits the phone viewport. Read-only browser inspection entered no credentials; UI regressions cover actual delivery-mode copy and private-storage absence, while native/compiled tests exercise sending and using synthetic links.

Hosted account mode retains this visual language and replaces local-trial instructions with approved-work-email guidance. Owner, observation and preview links are absent from the hosted header/footer; the separate server enforces those route boundaries. Hosted help links back to the company account workspace and includes the company-hosting pilot guide. Read-only rendered checks at 1280 and 390 pixels found no horizontal overflow in either surface; no account credentials were entered. UI tests cover the hosted copy/navigation and existing local behavior.

The company installer at `/company` extends the existing standalone setup form rather than the account workspace. It retains the dark green setup palette, visible labels, full-width controls and a stacked phone layout. The owner/company links carry only the ephemeral setup fragment between these local pages. Read-only browser checks at 1280 and 390 pixels verified the company form and actions without horizontal overflow or credential entry. Credential erasure, result locking and nonce handling are exercised with the actual setup scripts in DOM tests.
