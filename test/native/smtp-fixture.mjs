import { createServer as netServer } from "node:net";
import { createServer as tlsServer, createSecureContext, TLSSocket } from "node:tls";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function smtpCertificates(host = "localhost") {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-synthetic-smtp-")),
    keyPath = join(directory, "key.pem"),
    caFile = join(directory, "certificate.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      keyPath,
      "-out",
      caFile,
    ],
    { stdio: "ignore" },
  );
  await chmod(caFile, 0o600);
  return {
    directory,
    caFile,
    key: await readFile(keyPath, "utf8"),
    cert: await readFile(caFile, "utf8"),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
export async function syntheticSmtp(certificates, options = {}) {
  const sockets = new Set(),
    messages = [],
    counts = { auth: 0, data: 0, connections: 0, ended: 0 },
    releases = [];
  const secureContext = createSecureContext({ key: certificates.key, cert: certificates.cert });
  function protocol(socket, secure, greeting = true) {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", () => {
      counts.ended++;
      if (!options.holdClose) socket.end();
    });
    let buffer = "",
      data = false;
    const write = (value) => {
      if (!socket.destroyed) socket.write(value);
    };
    function receive(chunk) {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (data) {
          const at = buffer.indexOf("\r\n.\r\n");
          if (at < 0) return;
          const message = buffer.slice(0, at);
          buffer = buffer.slice(at + 5);
          data = false;
          messages.push(message);
          const reply = () => write(options.finalReply ?? "250 Queued\r\n");
          if (options.holdData) releases.push(reply);
          else reply();
          continue;
        }
        const at = buffer.indexOf("\r\n");
        if (at < 0) return;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (line.startsWith("EHLO") || line.startsWith("HELO"))
          write(
            `250-localhost\r\n${!secure && options.advertiseStarttls !== false ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`,
          );
        else if (line === "STARTTLS") {
          if (options.advertiseStarttls === false || options.rejectStarttls) {
            write("454 TLS unavailable\r\n");
            continue;
          }
          socket.removeListener("data", receive);
          write("220 Start TLS\r\n");
          const tls = new TLSSocket(socket, {
            isServer: true,
            secureContext,
            allowHalfOpen: !!options.holdClose,
          });
          protocol(tls, true, false);
          return;
        } else if (line.startsWith("AUTH")) {
          counts.auth++;
          write(options.authReply ?? (secure ? "235 Authenticated\r\n" : "530 TLS required\r\n"));
        } else if (line.startsWith("MAIL FROM:")) write("250 Sender accepted\r\n");
        else if (line.startsWith("RCPT TO:"))
          write(options.recipientReply ?? "250 Recipient accepted\r\n");
        else if (line === "DATA") {
          counts.data++;
          data = true;
          write("354 End with dot\r\n");
        } else if (line === "QUIT") {
          write("221 Bye\r\n");
          socket.end();
        } else write("250 OK\r\n");
      }
    }
    socket.on("data", receive);
    if (greeting) write("220 Synthetic local mail server\r\n");
  }
  const server = options.starttls
    ? netServer({ allowHalfOpen: !!options.holdClose }, (socket) => {
        counts.connections++;
        protocol(socket, false);
      })
    : tlsServer(
        { key: certificates.key, cert: certificates.cert, allowHalfOpen: !!options.holdClose },
        (socket) => {
          counts.connections++;
          protocol(socket, true);
        },
      );
  server.on("tlsClientError", () => {});
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    messages,
    counts,
    releases,
    port,
    config: {
      host: "localhost",
      port,
      security: options.starttls ? "starttls" : "implicit-tls",
      username: "synthetic-smtp-user",
      password: "synthetic SMTP password never logged!",
      sender: "accounts@example.test",
      ca: certificates.cert,
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export function messageText(message) {
  return Buffer.from(
    message.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\s/g, ""),
    "base64",
  ).toString("utf8");
}
