export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (value: unknown, status = 200) => Response.json(value, { status });
export async function input(request: Request, keys: string[]): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Use a JSON object");
  }
  return objectInput(body, keys);
}
export function objectInput(body: unknown, keys: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  )
    throw new HttpError(400, "Unexpected request fields");
  return body as Record<string, unknown>;
}
export function textValue(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new HttpError(400, "Invalid text value");
  return value.trim();
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
