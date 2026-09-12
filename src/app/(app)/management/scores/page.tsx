import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { ScoresClient } from "./scores-client";

/**
 * RP-03 — Management Scores.
 *
 * Reading needs `reports.view`; recording, editing and approving need
 * `reports.score.manage`. Both are checked again on the API routes.
 */
export default async function ScoresPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "reports.view")) redirect("/403");

  return <ScoresClient canManage={hasPermission(user, "reports.score.manage")} />;
}
