import { nativeConfiguration, requireNativeRuntime } from "./configuration.js";

const usage =
  "checkpoint --output new-file | template --data quarantined-data-directory --output new-file | validate --data quarantined-data-directory --manifest private-review-file --output new-file";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && !args.length) {
    console.log(usage);
    return;
  }
  const expected =
    command === "checkpoint"
      ? ["--output"]
      : command === "template"
        ? ["--data", "--output"]
        : command === "validate"
          ? ["--data", "--manifest", "--output"]
          : [];
  if (
    !expected.length ||
    args.length !== expected.length * 2 ||
    expected.some((key, index) => args[index * 2] !== key || !args[index * 2 + 1])
  )
    throw new Error(usage);
  const options = Object.fromEntries(expected.map((key, index) => [key, args[index * 2 + 1]!]));
  requireNativeRuntime();
  const review = await import("./recovery-review.js");
  let result;
  if (command === "checkpoint") {
    const settings = nativeConfiguration();
    result = await review.checkpointNativeCommercial(
      settings.configuration,
      settings.directory,
      options["--output"]!,
    );
  } else if (command === "template")
    result = await review.createNativeRecoveryReviewTemplate(
      options["--data"]!,
      options["--output"]!,
    );
  else
    result = await review.validateNativeRecoveryReview(
      options["--data"]!,
      options["--manifest"]!,
      options["--output"]!,
    );
  console.log(JSON.stringify(result));
}
void main().catch(() => {
  console.error(
    "Recovery review failed. Keep the restored service quarantined. Check the exact review, private current evidence, matching checkpoint, lifecycle lock and unused output path.",
  );
  process.exitCode = 1;
});
