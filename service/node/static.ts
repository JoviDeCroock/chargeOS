import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

export async function commercialStatic(path: string, directory: string): Promise<Response> {
  if (path === "/") return new Response(null, { status: 302, headers: { Location: "/service" } });
  const page = ["/service", "/service/", "/help", "/help/"].includes(path);
  if (!page && !/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|webp|ico|woff2)$/.test(path))
    return new Response("Not found", { status: 404 });
  const name = page ? "index.html" : path.slice(1);
  let file;
  try {
    file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await file.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("Invalid UI asset");
    const content = await file.readFile();
    if (content.length > 2 * 1024 * 1024) throw new Error("UI asset exceeds boundary");
    const types: Record<string, string> = {
      html: "text/html; charset=utf-8",
      js: "text/javascript; charset=utf-8",
      css: "text/css; charset=utf-8",
      svg: "image/svg+xml",
      png: "image/png",
      webp: "image/webp",
      ico: "image/x-icon",
      woff2: "font/woff2",
    };
    const body = page
      ? content
          .toString("utf8")
          .replace('<html lang="en">', '<html lang="en" data-commercial-hosting="production">')
          .replace(
            "<title>chargeOS owner console</title>",
            "<title>Company accounts · chargeOS</title>",
          )
      : content;
    return new Response(body, {
      headers: {
        "Content-Type": types[name.split(".").pop()!] ?? "application/octet-stream",
        "Cache-Control": page ? "no-store" : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  } finally {
    await file?.close();
  }
}
