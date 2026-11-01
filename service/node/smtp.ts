import SMTPConnection from "nodemailer/lib/smtp-connection";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { exactObject } from "./recovery-crypto.js";
import { readPrivateRecoveryFile } from "./recovery-files.js";

export interface SmtpConfiguration {
  host: string;
  port: number;
  security: "implicit-tls" | "starttls";
  username: string;
  password: string;
  sender: string;
  ca?: string;
}
export type MailFailure =
  | "smtp-temporary"
  | "smtp-permanent"
  | "smtp-tls"
  | "smtp-auth"
  | "smtp-timeout";
export class SmtpFailure extends Error {
  constructor(
    readonly reason: MailFailure,
    readonly retryable: boolean,
  ) {
    super("Email transport failed");
  }
}
export function mailbox(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
      value,
    )
  )
    throw new Error("Use a single email address without a display name");
  return value;
}
export async function readSmtpConfiguration(path: string): Promise<SmtpConfiguration> {
  const value: unknown = JSON.parse((await readPrivateRecoveryFile(path, 16384)).toString("utf8"));
  exactObject(value, [
    "format",
    "schemaVersion",
    "host",
    "port",
    "security",
    "username",
    "password",
    "sender",
    "caFile",
  ]);
  if (
    value.format !== "chargeos-smtp" ||
    value.schemaVersion !== 1 ||
    typeof value.host !== "string" ||
    value.host.length > 253 ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value.host) ||
    isIP(value.host) ||
    typeof value.security !== "string" ||
    !["implicit-tls", "starttls"].includes(value.security) ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  )
    throw new Error("Use a declared SMTP hostname, port and required TLS mode");
  for (const key of ["username", "password"])
    if (
      typeof value[key] !== "string" ||
      !value[key].length ||
      value[key].length > 2048 ||
      /[\0\r\n]/.test(value[key])
    )
      throw new Error("Use bounded SMTP credentials");
  const config: SmtpConfiguration = {
    host: value.host,
    port: value.port,
    security: value.security as SmtpConfiguration["security"],
    username: value.username as string,
    password: value.password as string,
    sender: mailbox(value.sender),
  };
  if (value.caFile !== null) {
    if (typeof value.caFile !== "string" || !value.caFile.length)
      throw new Error("Use a private CA file or null");
    config.ca = (await readPrivateRecoveryFile(value.caFile, 65536)).toString("utf8");
    if (!config.ca.includes("-----BEGIN CERTIFICATE-----") || config.ca.includes("PRIVATE KEY"))
      throw new Error("Use only a CA certificate");
  }
  return config;
}
export interface AccountMail {
  id: string;
  kind: string;
  recipient: string;
  url: string;
  createdAt: number;
  expiresAt: number;
}
export function accountMessage(mail: AccountMail, sender: string): string {
  mailbox(sender);
  mailbox(mail.recipient);
  const titles: Record<string, string> = {
    "verify-email": "Verify your chargeOS email",
    "reset-password": "Reset your chargeOS password",
    invitation: "Join your chargeOS company workspace",
  };
  const title = titles[mail.kind];
  if (!title || !Number.isFinite(mail.createdAt) || !Number.isFinite(mail.expiresAt))
    throw new Error("Unsupported account message");
  const domain = sender.split("@")[1]!,
    id = createHash("sha256").update(`chargeos-account-mail:1:${mail.id}`).digest("hex");
  const text = `${title}\n\nOpen this private link:\n${mail.url}\n\nIt expires at ${new Date(mail.expiresAt).toISOString()}.\n\nIf you did not request this, ignore this message. Never forward this link or send it to support.\n`;
  const encoded = Buffer.from(text, "utf8")
    .toString("base64")
    .match(/.{1,76}/g)!
    .join("\r\n");
  return [
    `From: <${sender}>`,
    `To: <${mail.recipient}>`,
    `Subject: ${title}`,
    `Date: ${new Date(mail.createdAt).toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
    "",
  ].join("\r\n");
}
function failure(error: unknown): SmtpFailure {
  const value = error as { code?: unknown; originalCode?: unknown; responseCode?: unknown };
  const temporary =
    typeof value?.responseCode === "number" &&
    value.responseCode >= 400 &&
    value.responseCode < 500;
  if (value?.code === "EAUTH") return new SmtpFailure("smtp-auth", temporary);
  if (
    [value?.code, value?.originalCode].some(
      (code) => typeof code === "string" && /CERT|TLS|SSL|ALTNAME|SELF_SIGNED/.test(code),
    )
  )
    return new SmtpFailure("smtp-tls", temporary);
  if (typeof value?.responseCode === "number" && value.responseCode >= 500)
    return new SmtpFailure("smtp-permanent", false);
  return new SmtpFailure("smtp-temporary", true);
}
/** Own the socket through physical close, not merely SMTPConnection's early
 * 'end' event. No queue/recovery custody may finish while DATA can still flow. */
export async function sendAccountMail(config: SmtpConfiguration, mail: AccountMail): Promise<void> {
  const message = accountMessage(mail, config.sender),
    deadline = Math.min(30000, mail.expiresAt - Date.now());
  if (deadline <= 0) throw new SmtpFailure("smtp-timeout", false);
  const connection = new SMTPConnection({
    host: config.host,
    port: config.port,
    secure: config.security === "implicit-tls",
    requireTLS: config.security === "starttls",
    ignoreTLS: false,
    opportunisticTLS: false,
    servername: config.host,
    name: "chargeos.local",
    connectionTimeout: 10000,
    dnsTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    maxResponseSize: 16384,
    logger: false,
    debug: false,
    transactionLog: false,
    tls: {
      rejectUnauthorized: true,
      servername: config.host,
      minVersion: "TLSv1.2",
      ...(config.ca ? { ca: config.ca } : {}),
    },
  });
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (problem?: SmtpFailure) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const socket = connection._socket;
      const drained =
        socket && !socket.closed
          ? new Promise<void>((done) => {
              socket.once("close", () => done());
            })
          : Promise.resolve();
      connection.close();
      if (socket && !socket.destroyed) socket.destroy();
      void drained.then(() => (problem ? reject(problem) : resolve()));
    };
    const timer = setTimeout(() => finish(new SmtpFailure("smtp-timeout", true)), deadline);
    connection.on("error", (error) => finish(failure(error)));
    connection.on("end", () => {
      if (!finished) finish(new SmtpFailure("smtp-temporary", true));
    });
    connection.connect(() => {
      if (finished) return;
      if (!connection.secure) {
        finish(new SmtpFailure("smtp-tls", false));
        return;
      }
      connection.login({ user: config.username, pass: config.password }, (error) => {
        if (finished) return;
        if (error) {
          finish(failure(error));
          return;
        }
        connection.send({ from: config.sender, to: [mail.recipient] }, message, (error, info) => {
          if (finished) return;
          finish(
            error
              ? failure(error)
              : info?.accepted?.includes(mail.recipient)
                ? undefined
                : new SmtpFailure("smtp-permanent", false),
          );
        });
      });
    });
  });
}
