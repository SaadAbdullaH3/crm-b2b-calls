import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { MonitoringClient } from "./monitoring-client";

/**
 * MG-09 — the Management monitoring view.
 *
 * Permission-gated rather than role-gated so Admin can reach it too, and so
 * an Admin who revokes `monitoring.view` from Management actually closes the
 * door. The real boundary is on /api/monitoring/live; this is UX.
 */
export default async function MonitoringPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "monitoring.view")) redirect("/403");
  return <MonitoringClient />;
}
