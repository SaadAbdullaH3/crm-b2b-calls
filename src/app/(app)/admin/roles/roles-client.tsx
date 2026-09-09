"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * AD-02 — the role x permission matrix.
 *
 * TM-05 shows up twice here, deliberately:
 *   * `monitoring.*` checkboxes are disabled on the agent row, with a visible
 *     reason rather than a silently missing control;
 *   * the API rejects the same combination regardless of what the UI sends.
 * The second one is the boundary. This one is only the explanation.
 */

interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
}

interface ModuleGroup {
  module: string;
  permissions: PermissionRow[];
}

interface RoleRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  activeUsers: number;
  permissionIds: string[];
}

function isLocked(roleName: string, key: string): string | null {
  if (roleName === "agent" && key.startsWith("monitoring.")) {
    return "TM-05: Active/Idle/Break/Productivity are Management-only.";
  }
  if (roleName === "admin" && key === "admin.roles.manage") {
    return "Removing this would make this screen unreachable.";
  }
  return null;
}

export function RolesClient() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [modules, setModules] = useState<ModuleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ roles: RoleRow[]; modules: ModuleGroup[] }>(
        "/api/admin/roles",
      );
      setRoles(data.roles);
      setModules(data.modules);
      setDirty(new Set());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(roleId: string, permissionId: string) {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r;
        const has = r.permissionIds.includes(permissionId);
        return {
          ...r,
          permissionIds: has
            ? r.permissionIds.filter((id) => id !== permissionId)
            : [...r.permissionIds, permissionId],
        };
      }),
    );
    setDirty((prev) => new Set(prev).add(roleId));
  }

  async function save() {
    setSaving(true);
    const failures: string[] = [];

    for (const roleId of dirty) {
      const role = roles.find((r) => r.id === roleId);
      if (!role) continue;
      try {
        await api(`/api/admin/roles/${roleId}/permissions`, {
          method: "PUT",
          json: { permissionIds: role.permissionIds },
        });
      } catch (e) {
        failures.push(`${role.label}: ${(e as Error).message}`);
      }
    }

    setSaving(false);

    if (failures.length > 0) {
      failures.forEach((f) => toast.error(f));
      // Re-read so the grid reflects what the server actually stored rather
      // than the rejected local edit.
      await load();
      return;
    }

    toast.success("Permission matrix saved.");
    await load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        requirement="AD-02"
        description="The database is authoritative once you change anything here — the defaults in permissions.ts are only the seed baseline. Route handlers check these keys, so a change takes effect on each user's next request."
        action={
          <Button onClick={() => void save()} disabled={dirty.size === 0 || saving}>
            {saving ? "Saving…" : dirty.size > 0 ? `Save ${dirty.size} role(s)` : "Saved"}
          </Button>
        }
      />

      <ErrorNote message={error} />

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left font-medium">Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="p-3 text-center font-medium whitespace-nowrap">
                  <div>{r.label}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {r.activeUsers} active
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <Fragment key={m.module}>
                <tr className="border-b bg-muted/20">
                  <td
                    colSpan={roles.length + 1}
                    className="px-3 py-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground"
                  >
                    {m.module}
                  </td>
                </tr>
                {m.permissions.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="p-3">
                      <div className="font-mono text-xs">{p.key}</div>
                      {p.description ? (
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      ) : null}
                    </td>
                    {roles.map((r) => {
                      const locked = isLocked(r.name, p.key);
                      const checked = r.permissionIds.includes(p.id);
                      return (
                        <td key={r.id} className="p-3 text-center">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary disabled:opacity-40"
                            checked={checked}
                            disabled={Boolean(locked)}
                            title={locked ?? undefined}
                            onChange={() => toggle(r.id, p.id)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Badge variant="outline">TM-05</Badge>
        <span>
          Agents cannot be granted <code className="font-mono">monitoring.*</code>. The
          checkbox is disabled here, and the API rejects it independently — the UI is not
          the boundary.
        </span>
      </div>
    </>
  );
}
