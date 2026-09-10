import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/**
 * HR-01 — employee profiles.
 *
 * Read needs `hr.employees.read` (HR and Management hold it, per SRS §17);
 * creating and editing needs `hr.employees.manage`, which Management does not.
 * Documents are a separate key again — see the documents route for HR-07.
 */

const EMPLOYEE_SELECT = {
  id: true,
  department: true,
  designation: true,
  shift: true,
  employmentType: true,
  joinedAt: true,
  confirmedAt: true,
  exitedAt: true,
  managerName: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      employeeCode: true,
      phone: true,
      isActive: true,
      role: { select: { name: true, label: true } },
    },
  },
  _count: { select: { documents: true, events: true } },
} as const;

export const GET = requirePermission("hr.employees.read", async (req) => {
  const includeExited = new URL(req.url).searchParams.get("includeExited") === "true";

  const employees = await prisma.hrEmployee.findMany({
    where: includeExited ? {} : { exitedAt: null },
    select: EMPLOYEE_SELECT,
    orderBy: [{ exitedAt: "asc" }, { user: { fullName: "asc" } }],
  });

  // Users with no HR record yet, so the UI can offer to create one rather than
  // leaving someone invisible to HR because nobody pressed a button.
  const withoutProfile = await prisma.user.findMany({
    where: { isActive: true, hrEmployee: null },
    select: { id: true, fullName: true, email: true, role: { select: { label: true } } },
    orderBy: { fullName: "asc" },
  });

  return ok({ employees, withoutProfile });
});

const CreateSchema = z.object({
  userId: z.string().min(1),
  department: z.string().max(80).trim().optional().nullable(),
  designation: z.string().max(80).trim().optional().nullable(),
  shift: z.string().max(60).trim().optional().nullable(),
  employmentType: z.string().max(40).trim().optional().nullable(),
  joinedAt: z.coerce.date().optional().nullable(),
  managerName: z.string().max(120).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
});

export const POST = requirePermission("hr.employees.manage", async (req, { user: actor }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;
  const data = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!target) return badRequest("That user does not exist.");

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.hrEmployee.create({
        data: {
          ...data,
          department: data.department || null,
          designation: data.designation || null,
          shift: data.shift || null,
          employmentType: data.employmentType || null,
          managerName: data.managerName || null,
          notes: data.notes || null,
        },
        select: EMPLOYEE_SELECT,
      });

      // HR-06 — the history starts with joining, so the timeline is never
      // empty and the joining date appears in the same place as everything
      // that follows it.
      if (data.joinedAt) {
        await tx.hrEmployeeEvent.create({
          data: {
            employeeId: created.id,
            type: "JOINED",
            title: "Joined the company",
            effectiveDate: data.joinedAt,
            recordedById: actor.id,
          },
        });
      }

      return created;
    });

    return ok({ employee }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return conflict("That user already has an employee record.");
    throw e;
  }
});
