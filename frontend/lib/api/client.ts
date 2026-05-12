import { getPublicEnv } from "@/lib/api/env";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiRequestOptions = {
  path: string;
  method?: string;
  token?: string | null;
  body?: BodyInit | Record<string, unknown> | null;
  headers?: HeadersInit;
};

function isBodyInit(value: unknown): value is BodyInit {
  return (
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    typeof value === "string"
  );
}

export async function apiRequest<T>({
  path,
  method = "GET",
  token,
  body,
  headers,
}: ApiRequestOptions): Promise<T> {
  const { apiBaseUrl } = getPublicEnv();
  const requestHeaders = new Headers(headers);

  let requestBody: BodyInit | undefined;
  if (body != null) {
    if (isBodyInit(body)) {
      requestBody = body;
    } else {
      requestHeaders.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    }
  }

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
