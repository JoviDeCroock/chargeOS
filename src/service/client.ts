export class ServiceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function serviceRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error =
      data && typeof data === "object" ? (data as { error?: string; message?: string }) : {};
    throw new ServiceRequestError(
      response.status,
      error.error ?? error.message ?? "The service could not complete this request.",
    );
  }
  return data as T;
}
