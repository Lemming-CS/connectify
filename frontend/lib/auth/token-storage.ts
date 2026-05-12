const ACCESS_TOKEN_KEY = "connectify.access_token";
const ACCESS_TOKEN_COOKIE = "connectify_access_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function canUseBrowserStorage() {
  return typeof window !== "undefined";
}

export function getAccessTokenStorageKey() {
  return ACCESS_TOKEN_KEY;
}

export function readAccessToken() {
  if (!canUseBrowserStorage()) {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function writeAccessToken(token: string) {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  document.cookie = `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function clearAccessToken() {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  document.cookie = `${ACCESS_TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function getAccessTokenCookieName() {
  return ACCESS_TOKEN_COOKIE;
}
