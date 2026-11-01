# Account-workspace design reference

Scope: the existing `/service` account interface and its `/service/recovery` extension. This reference records shipped code; the owner console, preview and observation workspaces retain their separate styles.

The account workspace uses a light `#f5f5ef` ground, `#fffefa` surfaces, dark green `#18352d` text and `#214b3d` primary controls. Typography inherits the existing local Inter/system stack. Forms use explicit labels, controls at least 44 pixels high, green visible focus, restrained rounded borders and generous separation between tasks. Body copy explains pending, failed and completed states without equating a software result with physical or financial authority.

The recovery extension keeps this language. Its main column is at most 740 pixels, form surface 600 pixels and phone layout remains fluid. The task heading has no eyebrow label. Setup keys are actual data in selectable wrapped code text; backup codes use two columns. No external imagery, fonts, scripts, analytics or new icon system is introduced. Private material is cleared on success/sign-out/user change; no persistent browser storage is used.

Source references: `src/service/style.css`, `src/service/recovery.css`, `src/service/recovery.tsx`. Direction and verification notes live in [the recovery surface brief](docs/design/recovery-enrollment.md).

Account delivery copy uses the typed service health mode. Operator-only mode explains private local links; SMTP mode explains queued email and localhost trial limits without promising inbox delivery or a public portal. Existing labels, controls and layout are retained; the decorative heading eyebrow is removed. No new visual assets or persistent browser state are introduced.

Scoped finish review: the rendered account and recovery-entry guidance preserves the account workspace at 1280 and 390 pixels with no horizontal overflow. The new email guide is reachable in `/help` and fits the phone viewport. Read-only browser inspection entered no credentials; UI regressions cover actual delivery-mode copy and private-storage absence, while native/compiled tests exercise sending and using synthetic links.
