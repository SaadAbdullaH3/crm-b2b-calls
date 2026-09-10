import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { HolidaysClient } from "./holidays-client";

/**
 * HR-05 — the holiday calendar.
 *
 * Readable by anyone who can request leave: an agent about to book time off
 * needs to know which days are already holidays, and hiding that just produces
 * wrong requests. Editing needs `hr.holidays.manage`.
 */
export default async function HolidaysPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "hr.leave.request")) redirect("/403");
  return <HolidaysClient canManage={hasPermission(user, "hr.holidays.manage")} />;
}
