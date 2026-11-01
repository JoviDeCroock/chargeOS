# Reviewed public company recovery

Implemented 2026-11-01 for the **synthetic owned-Docker pilot**. This completes a software path from an encrypted company backup through local quarantine, current review, fresh credentials and reviewed release to an exact HTTPS origin. It does not establish live provider/mailbox acceptance, customer operations, managed-cloud recovery, external source retirement or charger compatibility. Fresh company setup remains a separate workflow; no general database import is added to its wizard.

## Before a handoff

Follow [commercial recovery](commercial-service.md#encrypted-native-backup-and-quarantined-restore) through current identity/HR/finance/source-retirement review, fresh password/TOTP enrollment and reviewed local release. Keep restored data/configuration, the manifest, every referenced checkpoint/evidence file, capsule and SMTP settings **outside every software checkout/build context**, including symlink aliases. Docker builds copy source files into image/cache layers; recovery commands reject these private inputs inside a detected chargeOS build root before fencing or deployment preparation. Use matching reviewed software and retain the original private review manifest, every referenced evidence/checkpoint file, enrollment progress, restored configuration and database. The original review's 24-hour window must still be current at the actual handoff commit. All kept credential proofs must still match; identities, membership, eligibility and financial records must match the released state. A normal sign-in is allowed, but changing credentials or business records requires a new recovery epoch rather than editing receipts.

Stop the local account process and mail/enrollment workers; let their work finish. The handoff takes lifecycle custody and requires the normal process lease to be absent. Retire/fence every other actual service copy through the operator's reviewed external procedure. PID metadata, hashes and this tool cannot establish that external truth.

New releases use a version-2 receipt binding retained handoff history. Older version-1 releases remain locally readable; they cannot be silently upgraded for public use. For those copies, take the supported backup/checkpoint and repeat restore, current review and fresh enrollment/release with this software. Do not add fields to an old receipt.

With the restored `SERVICE_NATIVE_CONFIG` and `SERVICE_NATIVE_DATA` still selected, run:

```sh
pnpm service:native:public-handoff prepare --manifest /private/review/company-review.json --target /private/recovery/public-capsule --origin https://accounts.company.be --confirm 'I authorize this reviewed recovery at the exact HTTPS address after stopping all previous service copies'
```

The target parent must already be private; the capsule itself is create-only. Its real path and directory identity are bound to the intent. The compiled equivalent is `node dist/native-service/service/node/public-handoff-cli.js` with the same arguments. No SMTP settings, public listener or charger command is involved in this step.

## What the source commit proves

Preparation rechecks the exact original manifest/checkpoint/retirement and every identity/roster/finance evidence file, reconstructs their authenticated validated report, and checks the original review deadline. The signed enrollment state must be the exact state recorded by release, with real matching fresh password/TOTP proofs. Current source business state must match the reviewed released result. Hashes bind reviewed bytes; they do not independently validate identity, HR, balances or source retirement.

A consistent candidate is sanitized with `secure_delete` and `VACUUM`: sessions, verification/challenges, mail queue and rate records are removed, and pending invitations are revoked. Freshly enrolled passwords/authenticators and reviewed business data remain. A complete disposable public candidate includes the new receipts/history before exact schema, financial journal, logical-state and finished 64 MiB checks. The durable candidate and signed intent are flushed before source mutation. Actual review files, credentials, time, directory identity and full source state are checked again at the fence.

The atomic source transaction creates a signed `source-retired` handoff/history record and deletes the active release row. The old release remains authenticated history. Ordinary startup, HTTP, mail, outbox, export and checkpoint reject retired sources, including an old source whose handoff marker was subsequently removed. Only after the real fence authenticates does the candidate receive its separate `public-install` receipt, embedding that source retirement and binding the exact target origin, release/review/enrollment, source/candidate state and prior history.

The candidate is the capsule database; there is no second asynchronous database copy after fencing. Key, manifest and final READY output use flushed create-only private staging/link publication. A retry can finish only an exact owned link pair with the expected bytes. A partial private staging orphan is retained, never treated as a final file.

## Retry without creating another service

Before a committed fence, retry still requires unchanged source/candidate state, actual evidence and unexpired original review. After a committed fence, the same intent, package identity, source retirement and candidate authorize completion of that exact publication even if the old review files later expire or disappear. This recognizes completed authority; it does not approve a different roster or origin.

If interrupted, retain the source and original package. Audit any stale lifecycle/runtime lock against the actual stopped host/container/process before assessing custody. Then repeat the **same** command with the same source configuration, target, origin and confirmation. Do not move/replace the original package, choose another name, clear source retirement or recreate an active release row. An occupied/unrecognized target or changed candidate is an audit condition, not permission to overwrite it. Earlier failures before durable intent may leave a private incomplete package; it is not a ready capsule.

## Deploy the ready capsule

After a successful `prepared` result, the capsule contains mode-0600 `data/commercial.sqlite`, `auth.key`, `install.json`, `intent.json` and `READY` in private directories. It is **plaintext operational state with a live authentication key**, separate from the encrypted backup. Keep the original for retry/audit. A completed capsule may be copied privately to the actual Docker host with directory/file permissions preserved; a remote Docker context is unsupported. Never attach it or its key to support, AI helpdesk or search tools.

On that Docker host, have IT create a private mode-0600 JSON settings file using the same fields as company setup:

```json
{
  "name": "reviewed-company-recovery",
  "companyDomain": "accounts.company.be",
  "signupDomains": "company.be",
  "email": "it@company.be",
  "smtpHost": "smtp.your-provider.be",
  "smtpPort": "587",
  "smtpSecurity": "starttls",
  "smtpUsername": "from-your-provider",
  "smtpPassword": "from-your-provider",
  "smtpSender": "accounts@company.be"
}
```

Use the exact authorized hostname, approved work domains and newly supplied authenticated TLS mail settings. SMTP credentials and queue activation are not recovered from backup or capsule. Then run:

```sh
node scripts/resume-company.mjs --package /private/recovery/public-capsule --settings /private/recovery/company-settings.json --deploy
```

`--prepare` saves reviewable deployment files without launching account/mail containers. Start that **same** prepared deployment with `node scripts/resume-company.mjs --start /absolute/generated/deployment-folder`; its START-HERE.txt prints the exact command. `--start` rejects prepared folders moved into an unignored software checkout: use an external private folder or the original generated `.chargeos-deploy` subtree, which Docker explicitly excludes. It rechecks the saved local context and actual bind-file visibility, pins the project and strips inherited Compose controls. Do not repeat the initial command under a new name after uncertainty. The fresh-install browser wizard does not perform this recovery handoff.

The generated model derives from `compose.company.json`. Its network-free UID-1000 read-only initializer has 256 MiB temporary scratch and read-only capsule/key/manifest inputs. It authenticates exact incoming bytes, schema, finances, sanitized state and current HMAC/origin **before** accepting a new or existing target. It validates a same-volume private stage and publishes through a create-only link. A signed inode-bound journal can finish only its exact interrupted two-link pair; ordinary file validation still requires one link. Missing/changed journal or extra links refuse without unlinking foreign state. Incomplete-install markers prevent ordinary empty-database startup. Accounts start only after successful installation; mail starts after account health and uses only newly queued links.

A later `--start` may recognize the same authenticated installed handoff after legitimate business/auth changes; it never restores the original snapshot over those records. Recognition requires its key, origin, receipt/history and private publication journal/inode. Every later encrypted backup/restore drops active public handoff/release authority, rotates the secret, scrubs credentials and starts fresh quarantine. Historical handoff records remain in review/release integrity bindings.

## Acceptance and limits

Check actual DNS/HTTPS without certificate overrides, new-password/TOTP sign-in, old-session rejection, company access, new mailbox delivery and persistence across a normal stop/restart. Keep the exact deployment and volumes; stopping retains data. Existing dedicated-proxy/logging/signup/mail limits still apply. Container readiness does not establish inbox delivery, operational retention or live service parity.

The source fence prevents this known source from ordinary restart; it is not clone prevention or rollback proof. Anyone holding capsule and key can make another copy. The operator must independently keep all prior/parallel copies stopped and manage DNS, host custody and external retirement evidence. A new public-to-public move requires a new backup/quarantine/review/enrollment/release epoch. Managed-cloud capsule transfer and live customer/platform acceptance remain unverified. Charger ownership, card lists and already-authorized local charging remain separate.

`pnpm verify:company-recovery-runtime` exercises the compiled review/enrollment/release/fence and actual generated Docker deployment through HTTPS MFA/Secure cookies, old-cookie refusal, live idempotent install/restart, fresh verified STARTTLS mail and public backup into fresh quarantine. Native tests include real approved reimbursements through public backup, fresh recovery and a second public installation; history tamper, partial-marker failures, actual oversized finished preflight, evidence/credential/source changes and publication interruptions remain negative checks. These are synthetic software proofs, not field, external HR/finance or production acceptance.
