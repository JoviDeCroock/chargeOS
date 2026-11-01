import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ServiceEnv } from "../auth.js";
import { localConfiguration } from "../auth.js";
import worker from "../index.js";

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createNativeCommercialServer(env: ServiceEnv, handler: typeof worker = worker) {
  const config = localConfiguration(env);
  if (!config)
    throw new Error(
      "The native commercial service requires explicit loopback development configuration",
    );
  let listeningHost = "";
  let closing = false,
    closed: Promise<void> | undefined;
  const inFlight = new Set<Promise<void>>();
  const server = createServer(
    { maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 5000 },
    (request, response) => {
      if (closing) {
        response.writeHead(503, { "Cache-Control": "no-store", Connection: "close" });
        response.end();
        return;
      }
      const work = handle(request, response)
        .catch((error: unknown) => {
          if (response.headersSent || response.destroyed) {
            response.destroy();
            return;
          }
          const status = error instanceof RequestError ? error.status : 500;
          response.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            Connection: "close",
          });
          response.end(
            JSON.stringify({
              error:
                error instanceof RequestError ? error.message : "Commercial service request failed",
            }),
          );
        })
        .finally(() => {
          inFlight.delete(work);
        });
      inFlight.add(work);
    },
  );
  server.maxHeadersCount = 40;
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host;
    if (host !== new URL(config!.origin).host && host !== listeningHost)
      throw new RequestError(403, "Use the configured local service address");
    const target = request.url ?? "";
    if (!target.startsWith("/service/api/") || target.includes("\\"))
      throw new RequestError(404, "Service route not found");
    const url = new URL(target, config!.origin);
    if (url.origin !== config!.origin)
      throw new RequestError(403, "Use the configured local service address");
    const headers = new Headers();
    const untrusted = new Set([
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "forwarded",
      "x-real-ip",
    ]);
    for (const [name, value] of Object.entries(request.headers)) {
      if (untrusted.has(name) || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else headers.set(name, value);
    }
    // No caller can select its own auth rate-limit bucket. This local runtime
    // has no proxy-trust mode; the actual socket peer is the sole IP authority.
    headers.set("cf-connecting-ip", request.socket.remoteAddress ?? "127.0.0.1");
    const chunks: Buffer[] = [];
    let length = 0;
    request.setTimeout(10_000, () => request.destroy());
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      length += bytes.length;
      if (length > 524288) throw new RequestError(413, "Request is too large");
      chunks.push(bytes);
    }
    request.setTimeout(0);
    const method = request.method ?? "GET";
    const result = await handler.fetch(
      new Request(url.href, {
        method,
        headers,
        ...(length && method !== "GET" && method !== "HEAD"
          ? { body: new Uint8Array(Buffer.concat(chunks)) }
          : {}),
      }),
      env,
    );
    const output: Uint8Array[] = [];
    let size = 0;
    const reader = result.body?.getReader();
    if (reader)
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new RequestError(500, "Service response exceeds the local runtime limit");
        }
        output.push(part.value);
      }
    result.headers.forEach((value, name) => {
      if (name !== "set-cookie") response.setHeader(name, value);
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("Set-Cookie", cookies);
    response.writeHead(result.status);
    response.end(Buffer.concat(output));
  }
  return {
    async listen(port = 9091): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Native service did not bind a TCP port");
      listeningHost = `127.0.0.1:${address.port}`;
      return address.port;
    },
    close: () => {
      if (closed) return closed;
      closing = true;
      closed = (async () => {
        const error = await new Promise<Error | undefined>((resolve) => server.close(resolve));
        // A disconnected socket can disappear before its async auth work ends.
        // Custody and database lifetime follow handler promises, not sockets.
        while (inFlight.size) await Promise.allSettled(inFlight);
        if (error) throw error;
      })();
      return closed;
    },
  };
}
