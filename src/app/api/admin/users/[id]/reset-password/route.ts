import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { hashPassword } from "@/lib/auth/password";
import { ok, notFound, parseBody } from "@/lib/api";

/**
 * AD-01 — admin password reset.
 *
 * Resetting revokes every live session for that user. Without this, an
 * attacker who already had a session would keep it after the password change
 * that was meant to lock them out.
 */

const ResetSchema = z.object({
  password: z.string().min(8).max(200),
  /** Also sign the user out everywhere. Defaults on; off only for a
   *  self-service style reset where the user is mid-shift. */
  revokeSessions: z.boolean().default(true),
});

export const POST = requirePermission(
  "admin.users.manage",
  async (req, { params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, ResetSchema);
    if (!parsed.success) return parsed.res;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return notFound("No such user.");

    const passwordHash = await hashPassword(parsed.data.password);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      if (parsed.data.revokeSessions) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    return ok({ ok: true, sessionsRevoked: parsed.data.revokeSessions });
  },
);
