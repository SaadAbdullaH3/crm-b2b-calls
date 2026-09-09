import { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * Lead listing.
 *
 * Deliberately minimal — this exists so Day 4's manual assignment (LA-06/07/08)
 * has something to select from. The full search and filtering surface (SF-01 /
 * SF-02) and the lead timeline are Day 6; this will grow into that rather than
 * being replaced.
 *
 * Visibility follows the permission, not the role name: an agent holding only
 * `leads.read.own` sees their own leads, and `leads.read.all` sees everything.
 */
export const GET = requireAuth(async (req, { user }) => {
  const url = new URL(req.url);

  const canSeeAll = user.permissions.includes("leads.read.all");
  const status = url.searchParams.get("status");
  const assignedTo = url.searchParams.get("assignedTo");
  const q = url.searchParams.get("q")?.trim();
  const take = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const skip = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const where: Prisma.LeadWhereInput = {
    ...(canSeeAll ? {} : { assignedToId: user.id }),
    ...(status && status in LeadStatus ? { status: status as LeadStatus } : {}),
    ...(canSeeAll && assignedTo
      ? assignedTo === "UNASSIGNED"
        ? { assignedToId: null }
        : { assignedToId: assignedTo }
      : {}),
    ...(q
      ? {
          OR: [
            { companyName: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phoneE164: { contains: q } },
            { phoneRaw: { contains: q } },
          ],
        }
      : {}),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: "asc" }],
      skip,
      take,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        phoneE164: true,
        phoneRaw: true,
        email: true,
        city: true,
        state: true,
        status: true,
        sourceLabel: true,
        doNotCall: true,
        lockedAt: true,
        lastDispositionCode: true,
        lastDispositionAt: true,
        assignedTo: { select: { id: true, fullName: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return ok({ leads, total, offset: skip, limit: take, canSeeAll });
});
