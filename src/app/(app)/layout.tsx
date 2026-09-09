import { requirePageAuth } from "@/lib/auth/guard";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

// Every signed-in section renders inside this shell. Unauthenticated visitors
// are redirected here rather than in each child layout.
//
// <Toaster /> is mounted once here for the whole signed-in app. Without it,
// every toast() call anywhere in the app is a silent no-op — which is what was
// happening to the Day 2 Admin screens before this was added.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageAuth();
  return (
    <>
      <AppShell user={user}>{children}</AppShell>
      <Toaster richColors closeButton />
    </>
  );
}
