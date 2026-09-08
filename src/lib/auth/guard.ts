import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import type { RoleName } from "@/lib/auth/rbac";

/**
 * Page-level guards for server components.
 *
 * These give the user a sensible redirect instead of a broken screen. They are
 * NOT the security boundary — every action behind these pages still goes
 * through requireRole()/requirePermission() in its API route.
 */

export async function requirePageAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePageRole(roles: RoleName[]): Promise<SessionUser> {
  const user = await requirePageAuth();
  if (!roles.includes(user.roleName as RoleName)) redirect("/403");
  return user;
}
