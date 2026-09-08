import { requirePageRole } from "@/lib/auth/guard";

// Role gate for the management section. The real enforcement for any action taken
// inside these pages lives in the API routes (requireRole/requirePermission).
export default async function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole(["management"]);
  return <>{children}</>;
}
