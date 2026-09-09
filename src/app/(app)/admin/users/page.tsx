import { prisma } from "@/lib/db";
import { UsersClient } from "./users-client";

/**
 * AD-01 — user accounts.
 *
 * The role list is fetched server-side so the form has its options on first
 * paint. Everything mutating goes through /api/admin/users, which is where the
 * requirePermission("admin.users.manage") boundary actually lives.
 */
export default async function AdminUsersPage() {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, label: true },
    orderBy: { name: "asc" },
  });

  return <UsersClient roles={roles} />;
}
