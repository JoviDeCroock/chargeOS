import { nativeConfiguration } from "./configuration.js";

const usage =
  "issue --manifest private-review --output new-private-links | reissue --manifest private-review --email intended-person --output new-private-links | reissue-all --manifest private-review --output new-private-links | serve --manifest private-review";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && !args.length) {
    console.log(usage);
    return;
  }
  const keys =
    command === "serve"
      ? ["--manifest"]
      : command === "reissue"
        ? ["--manifest", "--email", "--output"]
        : ["issue", "reissue-all"].includes(command ?? "")
          ? ["--manifest", "--output"]
          : [];
  if (
    !keys.length ||
    args.length !== keys.length * 2 ||
    keys.some((key, index) => args[index * 2] !== key || !args[index * 2 + 1])
  )
    throw new Error(usage);
  const options = Object.fromEntries(keys.map((key, index) => [key, args[index * 2 + 1]!]));
  const settings = nativeConfiguration();
  if (command !== "serve") {
    const { issueNativeRecoveryEnrollment, reissueNativeRecoveryEnrollmentUser } =
      await import("./recovery-enrollment-state.js");
    console.log(
      JSON.stringify(
        command === "reissue"
          ? await reissueNativeRecoveryEnrollmentUser(
              settings.configuration,
              settings.directory,
              options["--manifest"]!,
              options["--email"]!,
              options["--output"]!,
            )
          : await issueNativeRecoveryEnrollment(
              settings.configuration,
              settings.directory,
              options["--manifest"]!,
              options["--output"]!,
              command === "reissue-all",
            ),
      ),
    );
    return;
  }
  const { withNativeRecoveryCustody } = await import("./recovery-review.js");
  const { createNativeRecoveryEnrollment } = await import("./recovery-enrollment.js");
  const { createNativeCommercialServer } = await import("./http.js");
  await withNativeRecoveryCustody(settings.directory, async () => {
    const enrollment = await createNativeRecoveryEnrollment(
      settings.directory,
      options["--manifest"]!,
      settings.configuration,
    );
    const server = createNativeCommercialServer(
      { ...settings.configuration, SERVICE_DB: enrollment.database },
      enrollment.handler,
    );
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      const port = await server.listen(settings.port);
      console.log(
        `Recovery enrollment listening on http://127.0.0.1:${port}. Use the private links individually; commercial access remains quarantined.`,
      );
      await stopped;
    } finally {
      try {
        await server.close();
      } finally {
        enrollment.close();
        process.removeListener("SIGTERM", stop);
        process.removeListener("SIGINT", stop);
      }
    }
  });
}
void main().catch(() => {
  console.error(
    "Recovery enrollment failed. Keep commercial access quarantined. Ask the administrator to check the review, configuration, private state and lifecycle custody. No private link or credential is printed here.",
  );
  process.exitCode = 1;
});
