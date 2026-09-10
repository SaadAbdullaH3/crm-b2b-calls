import { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * CL-01 — the agent's call list.
 *
 * Scoped to the caller with no userId parameter anywhere: an agent can only
 * ever see their own leads, and there is no argument that would widen it.
 *
 * Do-Not-Call leads are excluded (CL-05). They stay assigned for history but
 * must never appear in a list whose purpose is "dial these".
 *
 * Ordering is the working order, not an arbitrary one: overdue callbacks first,
 * then never-attempted leads, then everything else. An agent opening this
 * screen should be looking at the thing they most need to do next.
 */
export const GET = requirePermission("leads.read.own", async (req, { user }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const take = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);

  const where: Prisma.LeadWhereInput = {
    assignedToId: user.id,
    doNotCall: false,
    status: {
      notIn: [
        LeadStatus.CLOSED_QUALIFIED,
        LeadStatus.CLOSED_NOT_INTERESTED,
        LeadStatus.DO_NOT_CALL,
      ],
    },
    ...(q
      ? {
          OR: [
            { companyName: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { phoneE164: { contains: q } },
            { phoneRaw: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [leads, total, closed] = await Promise.all([
    prisma.lead.findMany({
      where,
      take,
      orderBy: [
        { nextCallbackAt: { sort: "asc", nulls: "last" } },
        { lastDispositionAt: { sort: "asc", nulls: "first" } },
        { lockedAt: "asc" },
      ],
      select: {
        id: true,
        companyName: true,
        contactName: true,
        jobTitle: true,
        phoneE164: true,
        phoneRaw: true,
        email: true,
        website: true,
        city: true,
        state: true,
        sourceLabel: true,
        status: true,
        callAttempts: true,
        lastDispositionCode: true,
        lastDispositionAt: true,
        nextCallbackAt: true,
        customFields: true,
      },
    }),
    prisma.lead.count({ where }),
    // Today's closed-out work, so the list emptying doesn't look like data loss.
    prisma.lead.count({
      where: {
        assignedToId: user.id,
        lastDispositionAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  return ok({ leads, total, workedToday: closed });
});
