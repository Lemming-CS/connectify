export const AUTH_ROUTES = ["/login", "/register"];
export const APP_ROUTES = ["/chat", "/settings"];

export function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

export function isProtectedRoute(pathname: string) {
  return APP_ROUTES.some((route) => pathname.startsWith(route));
}
