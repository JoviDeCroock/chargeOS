import { nativeConfiguration, requireNativeRuntime } from "./configuration.js";
import { readCommercialPassphrase } from "./recovery-files.js";

const usage =
  "Use export --output new-file --passphrase-file private-file, inspect --input bundle --passphrase-file private-file, or restore --input bundle --target new-directory --passphrase-file private-file";
try {
  const [command, ...args] = process.argv.slice(2);
  const expected =
    command === "export"
      ? ["--output", "--passphrase-file"]
      : command === "inspect"
        ? ["--input", "--passphrase-file"]
        : command === "restore"
          ? ["--input", "--target", "--passphrase-file"]
          : [];
  if (
    !expected.length ||
    args.length !== expected.length * 2 ||
    expected.some((key, index) => args[index * 2] !== key || !args[index * 2 + 1])
  )
    throw new Error(usage);
  const options = Object.fromEntries(expected.map((key, index) => [key, args[index * 2 + 1]!]));
  const passphrase = await readCommercialPassphrase(options["--passphrase-file"]!);
  // Inspection and restore need only the bundle and passphrase on a fresh host.
  // Check Node before importing SQLite, without requiring the lost config file.
  requireNativeRuntime();
  const recovery = await import("./recovery.js");
  const settings = command === "export" ? nativeConfiguration() : undefined;
  const result =
    command === "export"
      ? await recovery.exportCommercialRecovery(
          settings!.configuration,
          settings!.directory,
          options["--output"]!,
          passphrase,
        )
      : command === "inspect"
        ? await recovery.inspectCommercialRecovery(options["--input"]!, passphrase)
        : await recovery.restoreCommercialRecovery(
            options["--input"]!,
            options["--target"]!,
            passphrase,
          );
  console.log(JSON.stringify(result));
} catch {
  // SQL/parser/path errors can contain sensitive material. No raw causes or
  // bundle contents are reflected by the operator CLI.
  console.error(
    "Commercial recovery failed. Check the command, private files, passphrase, software version and unused destination. Existing source data was not replaced.",
  );
  process.exitCode = 1;
}
