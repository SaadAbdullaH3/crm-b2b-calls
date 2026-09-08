import { requirePageRole } from "@/lib/auth/guard";

// Role gate for the hr section. The real enforcement for any action taken
// inside these pages lives in the API routes (requireRole/requirePermission).
export default async function HrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole(["hr"]);
  return <>{children}</>;
}
