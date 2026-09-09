import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * AD overview. Counts come straight from the database so the page reflects
 * what the configuration screens have actually stored.
 */
export default async function AdminPage() {
  const [users, activeUsers, roles, groups, fields, activeFields, settings] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.role.count(),
      prisma.group.count(),
      prisma.leadFieldDefinition.count(),
      prisma.leadFieldDefinition.count({ where: { isActive: true } }),
      prisma.systemSetting.count(),
    ]);

  const tiles = [
    {
      href: "/admin/users",
      label: "Users",
      requirement: "AD-01",
      value: `${activeUsers} active`,
      detail: `${users} total`,
    },
    {
      href: "/admin/roles",
      label: "Roles & Permissions",
      requirement: "AD-02",
      value: `${roles} roles`,
      detail: "Runtime permission matrix",
    },
    {
      href: "/admin/groups",
      label: "Groups",
      requirement: "AD-03",
      value: `${groups} groups`,
      detail: "Messaging and broadcast targets",
    },
    {
      href: "/admin/fields",
      label: "Lead Fields",
      requirement: "AD-05",
      value: `${activeFields} active`,
      detail: `${fields} defined`,
    },
    {
      href: "/admin/dialer",
      label: "Dialer Settings",
      requirement: "AD-06",
      value: "VC Dialer",
      detail: "Connection and credentials",
    },
    {
      href: "/admin/settings",
      label: "Time & Breaks",
      requirement: "AD-07",
      value: `${settings} settings`,
      detail: "Shift, idle threshold, breaks",
    },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Admin Configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts, permissions, groups, dynamic lead fields and system settings.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  {t.label}
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                    {t.requirement}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{t.value}</p>
                <p className="text-xs text-muted-foreground">{t.detail}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Audit log search (AU-04) arrives on Day 8, once Dev A&apos;s capture layer is
        writing entries.
      </p>
    </>
  );
}
