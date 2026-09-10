import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, parseBody } from "@/lib/api";

/**
 * HR-01/HR-06 — one employee profile with its history.
 *
 * Documents are NOT included here. This route is readable with
 * `hr.employees.read`, which Management holds; documents need
 * `hr.documents.manage`, which it does not (HR-07). Embedding them would have
 * quietly widened the more sensitive permission to match the less sensitive
 * one — the single easiest way to breach HR-07 without noticing.
 */

export const GET = requirePermission("hr.employees.read", async (_req, { params }) => {
  const id = params?.id as string;

  const employee = await prisma.hrEmployee.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          employeeCode: true,
          phone: true,
          isActive: true,
          lastLoginAt: true,
          role: { select: { name: true, label: true } },
        },
      },
      events: {
        orderBy: { effectiveDate: "desc" },
        include: { recordedBy: { select: { id: true, fullName: true } } },
      },
      _count: { select: { documents: true } },
    },
  });

  if (!employee) return notFound("No such employee.");
  return ok({ employee });
});

const UpdateSchema = z.object({
  department: z.string().max(80).trim().nullable().optional(),
  designation: z.string().max(80).trim().nullable().optional(),
  shift: z.string().max(60).trim().nullable().optional(),
  employmentType: z.string().max(40).trim().nullable().optional(),
  joinedAt: z.coerce.date().nullable().optional(),
  confirmedAt: z.coerce.date().nullable().optional(),
  exitedAt: z.coerce.date().nullable().optional(),
  managerName: z.string().max(120).trim().nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  address: z.string().max(500).trim().nullable().optional(),
  emergencyContactName: z.string().max(120).trim().nullable().optional(),
  emergencyContactPhone: z.string().max(40).trim().nullable().optional(),
  notes: z.string().max(2000).trim().nullable().optional(),
});

export const PATCH = requirePermission(
  "hr.employees.manage",
  async (req, { user: actor, params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, UpdateSchema);
    if (!parsed.success) return parsed.res;
    const data = parsed.data;

    const existing = await prisma.hrEmployee.findUnique({ where: { id } });
    if (!existing) return notFound("No such employee.");

    const employee = await prisma.$transaction(async (tx) => {
      const updated = await tx.hrEmployee.update({
        where: { id },
        data,
        include: { user: { select: { id: true, fullName: true } } },
      });

      // HR-06 — two transitions are significant enough to belong in the
      // timeline on their own, rather than only in an audit diff nobody reads.
      if (data.exitedAt && !existing.exitedAt) {
        await tx.hrEmployeeEvent.create({
          data: {
            employeeId: id,
            type: "EXIT",
            title: "Employment ended",
            effectiveDate: data.exitedAt,
            recordedById: actor.id,
          },
        });
      }
      if (data.confirmedAt && !existing.confirmedAt) {
        await tx.hrEmployeeEvent.create({
          data: {
            employeeId: id,
            type: "CONFIRMED",
            title: "Confirmed after probation",
            effectiveDate: data.confirmedAt,
            recordedById: actor.id,
          },
        });
      }

      return updated;
    });

    return ok({ employee });
  },
);
