import Link from "next/link";
import { NAV } from "@/lib/nav";
import type { SessionUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { Heartbeat } from "@/components/monitoring/heartbeat";
import { BreakControl } from "@/components/monitoring/break-control";

/**
 * Shared chrome for every signed-in section. The nav is driven entirely by
 * NAV[roleName], so a role can never render another role's links.
 */
export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const items = NAV[user.roleName] ?? [];

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <p className="text-sm font-semibold tracking-tight">CRM — B2B Calls</p>
            <p className="text-xs text-muted-foreground">{user.roleLabel}</p>
          </div>
          <NotificationBell />
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span>{item.label}</span>
              {item.day ? (
                <span className="text-[10px] text-muted-foreground">D{item.day}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="border-t p-3">
          {/* TM-04 — every role can take a break; TM-05 keeps the metrics off
              this screen. See break-control.tsx for what is deliberately not
              rendered here. */}
          <div className="pb-3">
            <BreakControl />
          </div>
          <p className="px-2 pb-2 text-xs font-medium">{user.fullName}</p>
          <p className="px-2 pb-3 text-xs text-muted-foreground">{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto p-8">{children}</main>

      {/* TM-01/TM-03 — renders nothing; reports tab-open + real-input signals. */}
      <Heartbeat />
    </div>
  );
}
