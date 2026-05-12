import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ACCESS_TOKEN_COOKIE = "connectify_access_token";

function isAuthRoute(pathname: string) {
  return pathname === "/login" || pathname === "/register";
}

function isProtectedRoute(pathname: string) {
  return pathname.startsWith("/chat") || pathname.startsWith("/settings");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value);

  if (pathname === "/") {
    return NextResponse.redirect(new URL(hasToken ? "/chat" : "/login", request.url));
  }

  if (isAuthRoute(pathname) && hasToken) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  if (isProtectedRoute(pathname) && !hasToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/register", "/chat/:path*", "/settings/:path*"],
};
