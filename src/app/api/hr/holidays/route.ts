import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/**
 * HR-05 — the holiday calendar.
 *
 * Reading needs only `hr.leave.request` (everyone): an agent about to book
 * leave needs to know which days are already holidays, and hiding that just
 * produces wrong requests. Writing needs `hr.holidays.manage`.
 */

export const GET = requirePermission("hr.leave.request", async (req) => {
  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();

  const holidays = await prisma.holiday.findMany({
    where: {
      OR: [
        { isRecurring: true },
        {
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
      ],
    },
    orderBy: { date: "asc" },
    include: { createdBy: { select: { id: true, fullName: true } } },
  });

  return ok({ year, holidays });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  date: z.coerce.date(),
  isRecurring: z.boolean().default(false),
  description: z.string().max(500).trim().optional().nullable(),
});

export const POST = requirePermission("hr.holidays.manage", async (req, { user }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;

  try {
    const holiday = await prisma.holiday.create({
      data: {
        name: parsed.data.name,
        date: parsed.data.date,
        isRecurring: parsed.data.isRecurring,
        description: parsed.data.description || null,
        createdById: user.id,
      },
    });
    return ok({ holiday }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return conflict("That holiday already exists on that date.");
    throw e;
  }
});
