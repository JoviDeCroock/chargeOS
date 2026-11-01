import { nativeConfiguration } from "./configuration.js";
const usage =
  "--manifest private-current-review --confirm 'I authorize reopening this reviewed replacement after retiring the previous service'";
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  if (args.length !== 4 || args[0] !== "--manifest" || !args[1] || args[2] !== "--confirm")
    throw new Error(usage);
  const settings = nativeConfiguration();
  const { releaseNativeCommercialRecovery } = await import("./recovery-release.js");
  console.log(
    JSON.stringify(
      await releaseNativeCommercialRecovery(
        settings.configuration,
        settings.directory,
        args[1],
        args[3]!,
      ),
    ),
  );
}
void main().catch(() => {
  console.error(
    "Commercial recovery release failed. Keep enrollment stopped; check current review, fresh credentials, private storage and lifecycle custody. Do not remove quarantine or edit its receipt. Retry the same command to recognize a release that committed before an interruption.",
  );
  process.exitCode = 1;
});
