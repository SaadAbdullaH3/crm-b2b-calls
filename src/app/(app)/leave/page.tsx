import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { LeaveClient } from "./leave-client";

/**
 * HR-05 — leave, for every role.
 *
 * Shared rather than duplicated under /hr and /agent: the form is identical
 * and only the visible rows differ. `canApprove` adds the review controls;
 * the API decides whose requests come back regardless of what this page asks.
 */
export default async function LeavePage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "hr.leave.request")) redirect("/403");

  return (
    <LeaveClient
      canApprove={hasPermission(user, "hr.leave.approve")}
      currentUserId={user.id}
    />
  );
}
