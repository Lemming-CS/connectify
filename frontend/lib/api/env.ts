const DEFAULT_API_BASE_URL = "http://localhost:8000/api/v1";

function sanitizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  return sanitizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL);
}

function resolveWebSocketBaseUrl(apiBaseUrl: string) {
  const configured = process.env.NEXT_PUBLIC_WS_BASE_URL;
  if (configured) {
    return sanitizeBaseUrl(configured);
  }

  const backendUrl = new URL(apiBaseUrl);
  backendUrl.protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
  backendUrl.pathname = "";
  backendUrl.search = "";
  backendUrl.hash = "";
  return sanitizeBaseUrl(backendUrl.toString());
}

export function getPublicEnv() {
  const apiBaseUrl = resolveApiBaseUrl();
  return {
    apiBaseUrl,
    websocketBaseUrl: resolveWebSocketBaseUrl(apiBaseUrl),
  };
}
