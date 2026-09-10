import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";

/**
 * SRS §8.1 — the Management Console.
 *
 * Permission-gated rather than role-gated so Admin reaches it too. The real
 * boundary is on /api/management/dashboard, which also decides independently
 * whether the monitoring block is included.
 */
export default async function ManagementPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "dashboard.management")) redirect("/403");
  return <DashboardClient />;
}
