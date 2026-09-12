import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { ReportHistoryClient } from "./history-client";

/** RP-04 — every report that was generated, still reachable afterwards. */
export default async function ReportHistoryPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "reports.view")) redirect("/403");

  return (
    <ReportHistoryClient
      canDownload={hasPermission(user, "reports.export")}
      canApprove={hasPermission(user, "reports.score.manage")}
    />
  );
}
