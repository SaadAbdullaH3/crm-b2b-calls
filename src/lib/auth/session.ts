import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_HOURS,
  hashToken,
  resolveSessionFromToken,
} from "@/lib/auth/session-core";

export { SESSION_COOKIE, resolveSessionFromToken };

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  roleName: string;
  roleLabel: string;
  permissions: string[];
}

export interface CreateSessionArgs {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Issues a session row and sets the cookie. Returns the new session id. */
export async function createSession({ userId, ip, userAgent }: CreateSessionArgs) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Enabled behind Nginx/TLS in production (NF-01).
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return { sessionId: session.id, expiresAt };
}

/**
 * Resolves the signed-in user from the session cookie, or null.
 *
 * A session is only valid when it is unrevoked AND unexpired — the same two
 * conditions the Socket.io handshake checks.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  if (!session.user.isActive) return null;

  // Cheap liveness signal; Dev B's monitoring engine builds on this column.
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return {
    id: session.user.id,
    email: session.user.email,
    fullName: session.user.fullName,
    roleName: session.user.role.name,
    roleLabel: session.user.role.label,
    permissions: session.user.role.permissions.map((rp) => rp.permission.key),
  };
}

/**
 * The current session's id, or null.
 *
 * Added by Dev B on Day 4. The Monitoring Engine measures screen time PER
 * SESSION, not per user — someone signed in on two machines has two work
 * sessions — so the heartbeat and break routes need the session id, and
 * `SessionUser` deliberately does not carry it.
 *
 * Read-only and additive: nothing existing changes behaviour. Kept separate
 * from getCurrentUser() so a route that only needs the id doesn't pay for the
 * role/permission join.
 */
export async function getCurrentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, revokedAt: true, expiresAt: true },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  return session.id;
}

/**
 * Revokes the current session and clears the cookie. Returns the revoked
 * session's id and user id so the caller can fire the LA-09 lead-return job
 * and the SESSION_ENDED socket event.
 */
export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.delete(SESSION_COOKIE);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!session || session.revokedAt) return null;

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  return { sessionId: session.id, userId: session.userId };
}
