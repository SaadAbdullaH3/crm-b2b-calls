"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/** AD-03 — user groups. Day 3 addresses broadcasts and group messages at these. */

interface UserOption {
  id: string;
  fullName: string;
  email: string;
  role: { name: string; label: string };
}

interface GroupMember extends UserOption {
  isActive: boolean;
  addedAt: string;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  members: GroupMember[];
}

export function GroupsClient({ allUsers }: { allUsers: UserOption[] }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await api<{ groups: GroupRow[] }>("/api/admin/groups");
      setGroups(data.groups);
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

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setName("");
    setDescription("");
    setMemberIds(new Set());
  }

  function openEdit(g: GroupRow) {
    setCreating(false);
    setEditing(g);
    setName(g.name);
    setDescription(g.description ?? "");
    setMemberIds(new Set(g.members.map((m) => m.id)));
  }

  function closeDialog() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    setSaving(true);
    const payload = { name, description, memberIds: [...memberIds] };
    try {
      if (editing) {
        await api(`/api/admin/groups/${editing.id}`, { method: "PATCH", json: payload });
        toast.success(`${name} updated.`);
      } else {
        await api("/api/admin/groups", { method: "POST", json: payload });
        toast.success(`${name} created.`);
      }
      closeDialog();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: GroupRow) {
    try {
      await api(`/api/admin/groups/${g.id}`, { method: "DELETE" });
      toast.success(`${g.name} deleted.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Groups"
        requirement="AD-03"
        description="Named sets of users. Day 3 uses these as the target for group messages, broadcasts and announcements (CM-05)."
        action={<Button onClick={openCreate}>New group</Button>}
      />

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState>No groups yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {g.name}
                    {g.isSystem ? (
                      <Badge variant="outline" className="text-[10px]">
                        system
                      </Badge>
                    ) : null}
                  </CardTitle>
                  {g.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{g.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(g)}>
                    Edit
                  </Button>
                  {!g.isSystem ? (
                    <Button size="sm" variant="ghost" onClick={() => void remove(g)}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">
                  {g.members.length} member{g.members.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.members.map((m) => (
                    <Badge key={m.id} variant="secondary" className="font-normal">
                      {m.fullName}
                    </Badge>
                  ))}
                  {g.members.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No members yet.</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={creating || Boolean(editing)} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit group" : "New group"}</DialogTitle>
            <DialogDescription>
              {editing?.isSystem
                ? "This is a system group — it can be renamed and re-populated, but not deleted."
                : "Members can be changed at any time."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-desc">Description</Label>
              <Input
                id="g-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Members ({memberIds.size})</Label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {allUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={memberIds.has(u.id)}
                      onChange={() => toggleMember(u.id)}
                    />
                    <span className="flex-1">{u.fullName}</span>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {u.role.label}
                    </Badge>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || name.trim() === ""}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
