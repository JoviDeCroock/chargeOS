# Use your own AI key

The owner console can help explain configuration checks using your own OpenAI or Anthropic API account. The AI helper can read the diagnostic summary you approve and, if you enable it, search the internet. You review its advice before doing anything to a charger.

## Get a key

Sign in to the [OpenAI developer platform](https://platform.openai.com/) or [Anthropic developer platform](https://platform.claude.com/) and create a dedicated API key for this use. Ask your administrator to help choose a model available to that account and set a spending limit. A chat subscription does not by itself establish API access or credit; check your provider account.

Keep the key in your password manager. It is different from your chargeOS owner token and from the charger password. You never need to give a charger an AI key.

## Ask for help

1. Open the owner console and choose the affected charger.
2. Open **Troubleshoot with your own AI key**.
3. Click **Review diagnostics**. You will see the exact connection and configuration-check summary that will be shared.
4. Select your AI provider, enter the model ID supplied by your administrator and paste your API key.
5. Describe the issue in ordinary language. For example: “Why is known-owner offline authorization blocked?” You may include a model and firmware name, but keep passwords, card identifiers, addresses and personal data out of the question.
6. Decide whether to allow internet searches, then tick the consent box and click **Get troubleshooting advice**.

The input key clears as soon as you send the request. chargeOS does not save it in browser storage, its evidence ledger or a recovery bundle. Your server operator and AI provider still handle the request, so use infrastructure and an account you trust. The provider bills you for API and optional search usage.

## Allow internet searches

Tick **Allow internet searches** before approving the question. This connects the AI to the selected provider's own web-search tool; you do not need to add a browser plugin or a separate search key. Your model/account must support that tool.

The helper can make up to three search tool calls. It chooses whether a search is useful. Open **Sources to check** under the answer and confirm that a manufacturer page applies to your exact model and firmware. Search results can be wrong or out of date; they do not prove compatibility.

## Act on the answer

The assistant has no tools to send charger commands, change RFID access, replace a back-office connection or move money. It cannot certify an offline charging test. Use the console's ordinary controls for supported operations, and involve your installer for device-specific or physical work.

If diagnostics changed, refresh the preview and approve it again. If the provider rejects the key, check its permissions, credit and model access. If it is unavailable, your normal console and previously synchronized local owner charging do not depend on it. Re-enter the key only when you choose to retry.

Technical details and provider references: [AI troubleshooting](../ai-troubleshooting.md).
