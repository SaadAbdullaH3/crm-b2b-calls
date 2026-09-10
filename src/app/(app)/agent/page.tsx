import { requirePageRole } from "@/lib/auth/guard";
import { AgentDashboardClient } from "./agent-dashboard-client";

export default async function AgentPage() {
  // The name is the only thing worth rendering server-side; every number comes
  // from /api/agent/dashboard, which cannot supply monitoring metrics (TM-05).
  const user = await requirePageRole(["agent"]);
  return <AgentDashboardClient name={user.fullName} />;
}
