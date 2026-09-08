import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";

/**
 * THE single RBAC enforcement point for the whole app (both tracks).
 *
 * Per .claude/CLAUDE.md: authorization is checked here, at the API-route level,
 * and is never re-implemented per screen. A page-level check is a UX nicety;
 * this is the actual boundary.
 *
 *   export const GET  = requirePermission("leads.read", async (req, { user }) => ...)
 *   export const POST = requireRole(["management", "admin"], handler)
 */

export type RoleName = "agent" | "management" | "admin" | "hr";

export interface AuthContext {
  user: SessionUser;
}

type Handler = (
  req: Request,
  ctx: AuthContext & { params?: Record<string, string | string[]> },
) => Promise<Response> | Response;

function unauthorized() {
  return NextResponse.json(
    { error: "UNAUTHENTICATED", message: "Sign in to continue." },
    { status: 401 },
  );
}

function forbidden(detail: string) {
  return NextResponse.json(
    { error: "FORBIDDEN", message: detail },
    { status: 403 },
  );
}

/** Requires a valid session; no specific role or permission. */
export function requireAuth(handler: Handler) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string | string[]>> }) => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const params = routeCtx?.params ? await routeCtx.params : undefined;
    return handler(req, { user, params });
  };
}

/** Requires the signed-in user to hold one of `roles`. */
export function requireRole(roles: RoleName[], handler: Handler) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string | string[]>> }) => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (!roles.includes(user.roleName as RoleName)) {
      return forbidden(`This action requires one of: ${roles.join(", ")}.`);
    }
    const params = routeCtx?.params ? await routeCtx.params : undefined;
    return handler(req, { user, params });
  };
}

/**
 * Requires a specific permission key from the roles/permissions tables.
 * Preferred over requireRole: Admin can re-map permissions to roles at runtime
 * without a code change.
 */
export function requirePermission(permissionKey: string, handler: Handler) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string | string[]>> }) => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (!user.permissions.includes(permissionKey)) {
      return forbidden(`Missing permission: ${permissionKey}.`);
    }
    const params = routeCtx?.params ? await routeCtx.params : undefined;
    return handler(req, { user, params });
  };
}

/** Non-throwing check, for conditionally rendering server components. */
export function hasPermission(user: SessionUser | null, key: string): boolean {
  return Boolean(user?.permissions.includes(key));
}
