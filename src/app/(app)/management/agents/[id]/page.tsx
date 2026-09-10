import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { AgentDetailClient } from "./agent-detail-client";

/** MG-05 — one agent's full drill-down. */
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageAuth();
  if (!hasPermission(user, "dashboard.management")) redirect("/403");
  const { id } = await params;
  return <AgentDetailClient agentId={id} />;
}
