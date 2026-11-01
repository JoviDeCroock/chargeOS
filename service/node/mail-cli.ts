import { nativeConfiguration } from "./configuration.js";
import { writePrivateRecoveryFile } from "./recovery-files.js";
import { mailHeartbeat, MAIL_HEALTH_FILE } from "./mail-health.js";
const usage =
  "template --output new-private-smtp.json | once --smtp-config private-smtp.json | run --smtp-config private-smtp.json";
async function main() {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (command === "--help" && flag === undefined) {
    console.log(usage);
    return;
  }
  if (
    extra.length ||
    !path ||
    !["template", "once", "run"].includes(command ?? "") ||
    flag !== (command === "template" ? "--output" : "--smtp-config")
  )
    throw new Error(usage);
  if (command === "template") {
    await writePrivateRecoveryFile(
      path,
      JSON.stringify(
        {
          format: "chargeos-smtp",
          schemaVersion: 1,
          host: "smtp.example.com",
          port: 587,
          security: "starttls",
          username: "",
          password: "",
          sender: "accounts@example.com",
          caFile: null,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Created private SMTP template. Fill in your provider's settings; no message has been sent.",
    );
    return;
  }
  const settings = nativeConfiguration();
  const { readSmtpConfiguration } = await import("./smtp.js"),
    { deliverNativeAccountMail } = await import("./mail.js");
  const smtp = await readSmtpConfiguration(
    path,
    settings.configuration.SERVICE_MODE === "production",
  );
  const healthPath = process.env.SERVICE_MAIL_HEALTH_FILE;
  if (healthPath && healthPath !== MAIL_HEALTH_FILE)
    throw new Error("Unsupported mail health path");
  const heartbeat = healthPath ? mailHeartbeat(healthPath) : undefined;
  let stopping = false,
    wake: () => void = () => {};
  const stop = () => {
    stopping = true;
    wake();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      if (stopping) break;
      const counts = await deliverNativeAccountMail(
        settings.configuration,
        settings.directory,
        smtp,
      );
      await heartbeat?.pulse();
      if (command === "once" || Object.values(counts).some((value) => value > 0))
        console.log(JSON.stringify(counts));
      if (command === "once" || stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, counts.accepted + counts.failed > 0 ? 100 : 5000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
        if (stopping) wake();
      });
    } while (!stopping);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await heartbeat?.close();
  }
}
void main().catch(() => {
  console.error(
    "Account email delivery stopped. Check explicit SMTP activation, private settings, provider connectivity, schema and recovery custody. No address, private link, password or provider response is printed. A stopped-process audit is required before clearing stale recovery custody.",
  );
  process.exitCode = 1;
});
