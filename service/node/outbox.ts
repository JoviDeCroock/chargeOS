import { nativeConfiguration } from "./configuration.js";

const argumentsList = process.argv.slice(2);
if (
  argumentsList.length !== 4 ||
  argumentsList[0] !== "--recipient" ||
  argumentsList[2] !== "--kind"
)
  throw new Error(
    "Use --recipient intended@example.test --kind verify-email|reset-password|invitation",
  );
const recipient = argumentsList[1]!,
  kind = argumentsList[3]!;
if (
  recipient.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
  !["verify-email", "reset-password", "invitation"].includes(kind)
)
  throw new Error("Use an intended local recipient and a supported delivery kind");
const { configuration, directory } = nativeConfiguration();
const { NativeCommercialDatabase } = await import("./sqlite.js");
const database = new NativeCommercialDatabase(directory, {
  recoverySecret: configuration.SERVICE_AUTH_SECRET,
  recoveryOrigin: configuration.SERVICE_ORIGIN,
});
try {
  const row = await database
    .prepare(
      "SELECT url FROM local_outbox WHERE recipient=? AND kind=? AND channel='local' AND expires_at>? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(recipient.toLowerCase(), kind, Date.now())
    .first<{ url: string }>();
  if (!row || new URL(row.url).origin !== configuration.SERVICE_ORIGIN)
    throw new Error("No current local link is available for this recipient and kind");
  // Deliberate operator-only secret output, never an HTTP route or runtime log.
  process.stdout.write(`${row.url}\n`);
} finally {
  database.close();
}
