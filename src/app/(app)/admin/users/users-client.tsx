"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, NativeSelect, ErrorNote, api } from "@/components/admin/admin-ui";

interface RoleOption {
  id: string;
  name: string;
  label: string;
}

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: RoleOption;
}

const BLANK = {
  email: "",
  fullName: "",
  password: "",
  roleId: "",
  employeeCode: "",
  phone: "",
};

export function UsersClient({ roles }: { roles: RoleOption[] }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK, roleId: roles[0]?.id ?? "" });
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(data.users);
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

  async function createUser() {
    setSaving(true);
    try {
      await api("/api/admin/users", { method: "POST", json: form });
      toast.success(`${form.fullName} created.`);
      setCreateOpen(false);
      setForm({ ...BLANK, roleId: roles[0]?.id ?? "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/api/admin/users/${editing.id}`, {
        method: "PATCH",
        json: {
          fullName: editing.fullName,
          email: editing.email,
          roleId: editing.role.id,
          employeeCode: editing.employeeCode,
          phone: editing.phone,
        },
      });
      toast.success("Saved.");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    try {
      await api(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        json: { isActive: !u.isActive },
      });
      toast.success(
        u.isActive
          ? `${u.fullName} deactivated — active sessions revoked.`
          : `${u.fullName} reactivated.`,
      );
      await load();
    } catch (e) {
      // The last-admin and self-deactivation guards land here.
      toast.error((e as Error).message);
    }
  }

  async function resetPassword() {
    if (!resetting) return;
    setSaving(true);
    try {
      await api(`/api/admin/users/${resetting.id}/reset-password`, {
        method: "POST",
        json: { password: newPassword, revokeSessions: true },
      });
      toast.success(`Password reset. ${resetting.fullName} has been signed out everywhere.`);
      setResetting(null);
      setNewPassword("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        requirement="AD-01"
        description="Create, edit, activate and deactivate accounts. Deactivating a user immediately revokes their live sessions."
        action={<Button onClick={() => setCreateOpen(true)}>Add user</Button>}
      />

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.isActive ? "" : "opacity-55"}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role.label}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{u.employeeCode ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    {u.isActive ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ ...u })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                      Reset password
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggleActive(u)}>
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* --- create --- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              The account is active immediately and can sign in with this password.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="roleId">Role</Label>
                <NativeSelect
                  id="roleId"
                  value={form.roleId}
                  onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="employeeCode">Employee code</Label>
                <Input
                  id="employeeCode"
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createUser()} disabled={saving}>
              {saving ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- edit --- */}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-name">Full name</Label>
                <Input
                  id="e-name"
                  value={editing.fullName}
                  onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-email">Email</Label>
                <Input
                  id="e-email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e-role">Role</Label>
                  <NativeSelect
                    id="e-role"
                    value={editing.role.id}
                    onChange={(e) => {
                      const r = roles.find((x) => x.id === e.target.value)!;
                      setEditing({ ...editing, role: r });
                    }}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-code">Employee code</Label>
                  <Input
                    id="e-code"
                    value={editing.employeeCode ?? ""}
                    onChange={(e) => setEditing({ ...editing, employeeCode: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- reset password --- */}
      <Dialog open={Boolean(resetting)} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {resetting?.fullName} will be signed out of every device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="newpw">New password</Label>
            <Input
              id="newpw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button onClick={() => void resetPassword()} disabled={saving}>
              {saving ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
