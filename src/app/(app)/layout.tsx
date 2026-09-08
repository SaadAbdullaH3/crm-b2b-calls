import { requirePageAuth } from "@/lib/auth/guard";
import { AppShell } from "@/components/app-shell";

// Every signed-in section renders inside this shell. Unauthenticated visitors
// are redirected here rather than in each child layout.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageAuth();
  return <AppShell user={user}>{children}</AppShell>;
}
