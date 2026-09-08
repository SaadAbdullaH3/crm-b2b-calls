import { requirePageRole } from "@/lib/auth/guard";

// Role gate for the admin section. The real enforcement for any action taken
// inside these pages lives in the API routes (requireRole/requirePermission).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole(["admin"]);
  return <>{children}</>;
}
