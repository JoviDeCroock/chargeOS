# Add a person

There are two kinds of access. The **employer workspace** has employee and finance accounts. The **owner console** controls a physical charger using its owner token. Creating an employer account never makes that person the owner of a home charger.

## Add an employee or finance reviewer

Your administrator can run the employer workspace as a local trial or a separate [HTTPS company pilot](company-hosting.md). Both use `/service`. The pilot requires an approved work email address and sends links by email. The local trial collects links in an operator outbox by default, with optional [account email](account-email.md). Use synthetic accounts while evaluating either mode.

1. Have the person create an account and verify it using the link supplied by email or the local operator.
2. Sign in as your organization's administrator and choose the right **Active organization**. If you have no organization yet, enter a **New organization name** and click **Create organization**; you become its administrator.
3. Under **Invite a colleague**, enter the person's exact verified email address. Choose **Driver** for an employee or **Finance** for a reimbursement reviewer, then click **Invite colleague**.
4. If email is enabled, have the recipient open their invitation email. Otherwise the local operator retrieves the invitation link and gives it privately to that intended account holder.
5. The person signs in to the matching verified account and clicks **Accept invitation** before it expires. Invitations expire after 72 hours.
6. Check that the new membership appears under **People**. An unused invitation can be withdrawn with **Revoke invitation**.

Finance reviewers should set up an authenticator app from **Account security** (**Set up authenticator**), then save the recovery codes privately. Approving a statement requires a current authenticator code and a reviewer different from the person who created that statement.

Drivers see their own reimbursement records. Finance members can review the organization's financial records. Only the administrator manages people and invitations. Adding more administrators or transferring administration is not currently available through this workflow.

In the local native SQLite trial, the operator retrieves an invitation using `pnpm service:native:outbox --recipient person@example.test --kind invitation`. The exact recipient and link kind must match. See [Install the software](install.md) for native setup and the separate Wrangler alternative. The native option can instead run the separately configured SMTP worker; the local operator command only retrieves local-outbox links.

## Name the people who charge

In the owner console, **People** (**Employees** with the company profile) lists the people who charge and links them to chargers and cards. Click **Add person**, then pick that person under **Edit names** on their charger or **Edit** on their card. Usage is reported per person. These names are labels in the owner console only: they create no account, give no access and never leave the owner console in exports or shared access. See [Name chargers, people and cards](owner-console.md#name-chargers-people-and-cards).

## Give a professional temporary charger access

Use the owner console's **Station settings › Shared access** tab for an installer, employer or energy provider. Choose the narrow role and expiry. Give the one-time secret only to the intended recipient, and revoke it when the work is finished. These are limited read capabilities; they do not create another owner or permit changing cards and charger settings. Step-by-step instructions are in [Use the owner console](owner-console.md).

Do not share the owner-console token as an ordinary invitation. Current software has one owner security domain, and that token is its root authority.

## When someone leaves

An administrator clicks **Remove access** next to the person under **People**, then reviews their eligibility and outstanding statements. Historical financial records remain available to authorized reviewers; removal does not rewrite them or revoke the household owner's local charging card. Remove a physical card separately only when the owner intends to do so; see [RFID cards](rfid.md). If the company's owner console runs that employee's charger, use **Leaves the company** there; see [Run company and employee chargers](company-chargers.md#when-an-employee-leaves).

Operator details: [Commercial service](../commercial-service.md) and [Reimbursement statements](../reimbursement-statements.md).
