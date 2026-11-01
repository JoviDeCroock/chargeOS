# Interface design reference

Scope: the owner console at `/` (first section) and the `/service` account interface with its `/service/recovery` extension (remaining sections). This reference records shipped code; the preview and observation workspaces retain their separate styles.

## Owner console

Source: `src/style.css`, `src/app.tsx`, `src/troubleshooting.css`.

Direction: frosted glass over soft colour fields, light by default with a token-for-token dark theme through `prefers-color-scheme`. Glass surfaces use a translucent fill, a bright one-pixel edge and `backdrop-filter` blur. `prefers-reduced-transparency` and browsers without backdrop filters fall back to opaque surfaces, and `prefers-reduced-motion` removes animation. Type uses the platform system stack (SF Pro, Segoe UI Variable, system-ui) with tight display tracking and tabular numerals. Monospace is reserved for real identifiers: pseudonyms, hashes, charge-point IDs and observed configuration values. No web fonts, external images, scripts or icon sets are loaded, so the console renders identically on an offline edge.

Palette (light): ground `#e3e9ed`, ink `#0f1f2b`, primary "current" teal `#0a6b73`, halo `#12b8a3`, ok `#11845a`, warn `#9a5a00`, risk `#bb3527`, live `#0b7f99`. The backdrop uses three blurred fields: teal, periwinkle and sand. Signal colours carry meaning only: green for passed/synchronized, amber for pending, red for stop conditions and destructive actions, blue-teal for live charging.

Hierarchy: a glass sidebar navigates hash-addressed pages (`#/overview`, `#/charging`, `#/cards`, `#/migration`, `#/freedom`, `#/delegates`, `#/evidence`, `#/assist`, plus `#/fleet` with several chargers). Navigation dots and badges flag pending or failed state per page. A sticky status bar names the charger and its connection. The Overview answers "can I charge without the cloud?" first, then shows At a glance, Station and the Genesis plan. The readiness halo is the single expressive element: a ring echoing a wall charger's status LED, drawn once on load with one segment per capability check. Genesis actions feature the first action, list three more and fold the rest; the six Genesis phases render as an ordered track because they are a real sequence. Typed confirmation phrases sit in a red-edged selectable block. Destructive buttons stay red; every disabled button is neutral grey.

Shape: radius encodes level (28 px hero/rail, 20 px panels, 14 px inner rows, 10–12 px controls, pills fully round). Rows inside panels are separated by hairlines rather than nested cards. Controls are at least 36 px, primary actions 44 px, with a visible focus ring.

Scoping: `src/style.css` loads on every route, so element selectors are wrapped in `:where(.console-backdrop)` and the base font size is set on the console root, leaving `/help`, `/service`, `/preview` and `/observe` unaffected.

Verified on the synthetic simulator at 1440×900 and 390×844 in light and dark: no horizontal overflow, keyboard skip link, `aria-current` on the active page and step. Rendered checks use synthetic credentials only and are not device evidence.

## Account workspace

The account workspace uses a light `#f5f5ef` ground, `#fffefa` surfaces, dark green `#18352d` text and `#214b3d` primary controls. Typography inherits the existing local Inter/system stack. Forms use explicit labels, controls at least 44 pixels high, green visible focus, restrained rounded borders and generous separation between tasks. Body copy explains pending, failed and completed states without equating a software result with physical or financial authority.

The recovery extension keeps this language. Its main column is at most 740 pixels, form surface 600 pixels and phone layout remains fluid. The task heading has no eyebrow label. Setup keys are actual data in selectable wrapped code text; backup codes use two columns. No external imagery, fonts, scripts, analytics or new icon system is introduced. Private material is cleared on success/sign-out/user change; no persistent browser storage is used.

Source references: `src/service/style.css`, `src/service/recovery.css`, `src/service/recovery.tsx`. Direction and verification notes live in [the recovery surface brief](docs/design/recovery-enrollment.md).

Account delivery copy uses the typed service health mode. Operator-only mode explains private local links; SMTP mode explains queued email and localhost trial limits without promising inbox delivery or a public portal. Existing labels, controls and layout are retained; the decorative heading eyebrow is removed. No new visual assets or persistent browser state are introduced.

Scoped finish review: the rendered account and recovery-entry guidance preserves the account workspace at 1280 and 390 pixels with no horizontal overflow. The new email guide is reachable in `/help` and fits the phone viewport. Read-only browser inspection entered no credentials; UI regressions cover actual delivery-mode copy and private-storage absence, while native/compiled tests exercise sending and using synthetic links.

Hosted account mode retains this visual language and replaces local-trial instructions with approved-work-email guidance. Owner, observation and preview links are absent from the hosted header/footer; the separate server enforces those route boundaries. Hosted help links back to the company account workspace and includes the company-hosting pilot guide. Read-only rendered checks at 1280 and 390 pixels found no horizontal overflow in either surface; no account credentials were entered. UI tests cover the hosted copy/navigation and existing local behavior.
