import { z } from "zod";
import { HrEventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, parseBody } from "@/lib/api";

/**
 * HR-06 — employment history.
 *
 * Create-and-read only. There is deliberately no edit or delete: a warning
 * that can be quietly removed is not a record, and an exit review months later
 * depends on the timeline being complete. Corrections are added as a further
 * NOTE, the way a ledger is corrected.
 */

const CreateSchema = z.object({
  type: z.nativeEnum(HrEventType),
  title: z.string().min(1).max(160).trim(),
  details: z.string().max(4000).trim().optional().nullable(),
  effectiveDate: z.coerce.date(),
});

export const POST = requirePermission(
  "hr.employees.manage",
  async (req, { user: actor, params }) => {
    const employeeId = params?.id as string;

    const employee = await prisma.hrEmployee.findUnique({ where: { id: employeeId } });
    if (!employee) return notFound("No such employee.");

    const parsed = await parseBody(req, CreateSchema);
    if (!parsed.success) return parsed.res;

    const event = await prisma.hrEmployeeEvent.create({
      data: {
        employeeId,
        type: parsed.data.type,
        title: parsed.data.title,
        details: parsed.data.details || null,
        effectiveDate: parsed.data.effectiveDate,
        recordedById: actor.id,
      },
      include: { recordedBy: { select: { id: true, fullName: true } } },
    });

    return ok({ event }, 201);
  },
);
