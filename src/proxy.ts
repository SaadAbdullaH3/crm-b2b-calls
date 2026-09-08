import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coarse route guard. In Next 16 this file is `proxy.ts` — `middleware.ts` was
 * deprecated and renamed.
 *
 * This ONLY checks that a session cookie is present, so an unauthenticated
 * visitor gets a redirect instead of a flash of empty layout. It deliberately
 * does not touch the database and does not decide permissions: the real
 * boundary is requireRole()/requirePermission() at the API-route level, plus
 * the role guard in each section's layout.
 */

const SESSION_COOKIE = "crm_session";

const PROTECTED_PREFIXES = ["/agent", "/management", "/admin", "/hr"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Exclude static assets and the Socket.io endpoint, which authenticates on
  // its own handshake.
  matcher: ["/((?!_next/static|_next/image|api/socket|favicon.ico).*)"],
};
