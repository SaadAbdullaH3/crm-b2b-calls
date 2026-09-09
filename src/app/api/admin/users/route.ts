import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { hashPassword } from "@/lib/auth/password";
import { ok, badRequest, parseBody, isUniqueViolation, conflict } from "@/lib/api";

/**
 * AD-01 — user accounts.
 *
 * `passwordHash` is never selected into a response on any route in this file.
 */

// Explicit select so a future column addition can't leak through by accident.
const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  employeeCode: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, label: true } },
} as const;

export const GET = requirePermission("admin.users.manage", async () => {
  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });
  return ok({ users });
});

const CreateUserSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  fullName: z.string().min(1).max(120).trim(),
  password: z.string().min(8).max(200),
  roleId: z.string().min(1),
  employeeCode: z.string().max(40).trim().optional().nullable(),
  phone: z.string().max(40).trim().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const POST = requirePermission("admin.users.manage", async (req) => {
  const parsed = await parseBody(req, CreateUserSchema);
  if (!parsed.success) return parsed.res;
  const { password, ...data } = parsed.data;

  const role = await prisma.role.findUnique({ where: { id: data.roleId } });
  if (!role) return badRequest("That role does not exist.");

  try {
    const user = await prisma.user.create({
      data: {
        ...data,
        // Empty strings would collide on the unique index, so store null.
        employeeCode: data.employeeCode || null,
        phone: data.phone || null,
        passwordHash: await hashPassword(password),
      },
      select: USER_SELECT,
    });
    return ok({ user }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return conflict("That email address or employee code is already in use.");
    }
    throw e;
  }
});
