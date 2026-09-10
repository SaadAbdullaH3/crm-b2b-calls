import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/permissions";
import { EVENTS, emitToUser } from "@/server/socket";
import { startWorkSession } from "@/server/monitoring/engine";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "Email and password are required." },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { role: true },
  });

  // One generic message for "no such user", "wrong password" and "deactivated"
  // so the form cannot be used to enumerate valid accounts.
  const invalid = NextResponse.json(
    { error: "INVALID_CREDENTIALS", message: "Incorrect email or password." },
    { status: 401 },
  );

  if (!user || !user.isActive) {
    // Spend roughly the same time as a real comparison so response timing
    // doesn't reveal whether the account exists.
    await verifyPassword(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    return invalid;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return invalid;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent");

  const { sessionId } = await createSession({ userId: user.id, ip, userAgent });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // TM-01 — screen time starts here, against this session id. Awaited so the
  // work session exists before the client's first heartbeat can arrive.
  try {
    await startWorkSession(sessionId, user.id);
  } catch (e) {
    console.error("[login] work session start failed", sessionId, e);
  }

  emitToUser(user.id, EVENTS.SESSION_STARTED, {
    userId: user.id,
    sessionId,
    at: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    redirectTo: ROLE_HOME[user.role.name] ?? "/",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleName: user.role.name,
    },
  });
}
