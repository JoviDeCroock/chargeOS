# Recovery enrollment

Mode: Operate. This is a local extension of the existing `/service` account forms. Its visual authority is `src/service/style.css` and the shipped account interface; it introduces no new identity or external assets.

## Direction contract

THESIS: Let one reviewed person replace credentials and verify a new authenticator without suggesting that business access has reopened.

OWN-WORLD: Retain the account workspace's shared chargeOS glass tokens (see `DESIGN.md`), native form controls, 44-pixel targets and visible focus. Use the existing restrained form width; avoid decorative badges, icons or new typography.

STORY: The person opens a private link, chooses a new password, adds an authenticator, saves recovery codes and verifies a code. Completion means credentials are ready; an administrator still controls reopening.

FIRST VIEWPORT: Existing account header, a direct task heading, short quarantine context and one active form. Help and returning-user sign-in remain easy to find. Errors explain retry versus administrator reissue.

FORM: Extend the incumbent account form with sequential task states and an explicit completion view. No concept roll is needed for this scoped extension. seed: none (unavailable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation evidence

The existing account CSS is the design reference; this extension adds only layout for transient authenticator material. No raster asset or outside resource is used. Verification must cover desktop/phone, keyboard focus, failure/retry, fragment removal and secret clearing before promotion.

## Finish review

Manual verdict: the entry and returning-user forms preserve the account workspace and meet the scoped task. Browser inspection at 1280 and 390 pixels showed no horizontal overflow; form widths were 600 and 358 pixels respectively. Labeled keyboard focus and prompt fragment removal were observed. Browser inspection used a disposable synthetic account and did not enter or change real credentials. Real HTTP tests exercise password/TOTP enrollment and returning MFA login; UI tests exercise completion, private-material clearing, failed challenge retry and stale-response rejection on a new link.

[DESIGN.md](../../DESIGN.md) records the existing account language and the extension's constraints. No raster asset ships, so no raster provenance is required. The optional design launcher returned no usable output; the finish review used the actual source and rendered browser result directly.
