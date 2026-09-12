import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { ReportsClient } from "./reports-client";

/**
 * SRS §8.2 / RP-01, RP-02 — the Reporting Engine screen.
 *
 * Permission-gated, not role-gated, so Admin reaches it too. The real boundary
 * is on Dev A's `/api/reports/*` routes, which check independently — and the
 * raw-data view and both exports sit behind `reports.export` rather than
 * `reports.view`, so a manager who may read a summary is not automatically
 * someone who may walk out with the contact list.
 */
export default async function ReportsPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "reports.view")) redirect("/403");

  return (
    <ReportsClient
      canExport={hasPermission(user, "reports.export")}
      canScore={hasPermission(user, "reports.score.manage")}
    />
  );
}
