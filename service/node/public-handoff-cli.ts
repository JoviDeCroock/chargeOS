import { existsSync } from "node:fs";
import { nativeConfiguration, requireNativeRuntime } from "./configuration.js";
import { MAX_COMMERCIAL_DATABASE_BYTES } from "./recovery-crypto.js";
import { readRuntimeBytes, readRuntimeFile } from "./runtime-files.js";

const usage =
  "prepare --manifest private-current-review --target new-private-package --origin exact-https-origin --confirm 'I authorize this reviewed recovery at the exact HTTPS address after stopping all previous service copies' | install --database mounted-capsule-db --auth mounted-capsule-key --manifest mounted-install-manifest --data empty-private-volume --origin exact-https-origin";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && !args.length) {
    console.log(usage);
    return;
  }
  const keys =
    command === "prepare"
      ? ["--manifest", "--target", "--origin", "--confirm"]
      : command === "install"
        ? ["--database", "--auth", "--manifest", "--data", "--origin"]
        : [];
  if (
    !keys.length ||
    args.length !== keys.length * 2 ||
    keys.some((key, index) => args[index * 2] !== key || !args[index * 2 + 1])
  )
    throw new Error(usage);
  const input = Object.fromEntries(keys.map((key, index) => [key, args[index * 2 + 1]!]));
  requireNativeRuntime();
  if (command === "prepare") {
    const { requireExternalHandoffPath } = await import("./handoff-paths.js");
    await requireExternalHandoffPath(process.env.SERVICE_NATIVE_CONFIG ?? "service/.dev.vars");
    const settings = nativeConfiguration(),
      { prepareNativePublicHandoff } = await import("./public-handoff.js");
    console.log(
      JSON.stringify(
        await prepareNativePublicHandoff(
          settings.configuration,
          settings.directory,
          input["--manifest"]!,
          input["--target"]!,
          input["--origin"]!,
          input["--confirm"]!,
        ),
      ),
    );
  } else {
    if (
      process.platform !== "linux" ||
      !existsSync("/.dockerenv") ||
      !process.getuid ||
      process.getuid() === 0
    )
      throw new Error("Use the non-root Docker installation profile");
    const bytes = readRuntimeBytes(input["--database"]!, MAX_COMMERCIAL_DATABASE_BYTES, true),
      secret = readRuntimeFile(input["--auth"]!, 4096, true),
      manifest = readRuntimeFile(input["--manifest"]!, 16384, true);
    const { installNativePublicHandoff } = await import("./public-install.js");
    console.log(
      JSON.stringify(
        await installNativePublicHandoff(
          bytes,
          secret,
          manifest,
          input["--data"]!,
          input["--origin"]!,
        ),
      ),
    );
  }
}
void main().catch(() => {
  console.error(
    "Public recovery handoff failed. Keep previous services stopped and retain the exact private package, source retirement and installation custody. Inspect the current review, fresh credentials, destination and any incomplete publication before retrying the same handoff; never delete markers or create a parallel service.",
  );
  process.exitCode = 1;
});
