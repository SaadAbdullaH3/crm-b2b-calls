/**
 * Session logic with NO Next.js dependencies.
 *
 * The custom server (server.ts -> socket.ts) is executed by tsx directly, not
 * through Next's bundler, so anything it imports must avoid both `server-only`
 * and `next/headers`. Cookie-bound helpers live in ./session.ts instead.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "crm_session";

export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 8);

/**
 * The cookie carries an opaque random token; only its hash is stored. A leaked
 * database backup therefore cannot be replayed as a live session.
 */
export function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHash("sha256").update(`${token}${secret}`).digest("hex");
}

/**
 * Resolves a raw session token to its user, or null when the session is
 * missing, revoked, expired, or the account has been deactivated.
 *
 * Used by the Socket.io handshake so a signed-out user cannot keep a live
 * socket open.
 */
export async function resolveSessionFromToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  if (!session.user.isActive) return null;

  return {
    sessionId: session.id,
    userId: session.user.id,
    roleName: session.user.role.name,
  };
}
