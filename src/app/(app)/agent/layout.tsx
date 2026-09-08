import { requirePageRole } from "@/lib/auth/guard";

// Role gate for the agent section. The real enforcement for any action taken
// inside these pages lives in the API routes (requireRole/requirePermission).
export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole(["agent"]);
  return <>{children}</>;
}
