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
import { PageHeader, NativeSelect, EmptyState, api } from "@/components/admin/admin-ui";
import { EVENTS } from "@/lib/realtime/events";
import { useSocketEvent } from "@/lib/realtime/use-socket";

/** CM-06 — announcements with optional required acknowledgement. */

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: "ALL" | "ROLE" | "GROUP";
  audienceRole: string | null;
  audienceGroup: { id: string; name: string } | null;
  requiresAcknowledgement: boolean;
  publishedAt: string;
  author: { id: string; fullName: string };
  acknowledgedAt: string | null;
  recipientCount: number;
  acknowledgedCount: number;
}

interface Targets {
  roles: { name: string; label: string; users: number }[];
  groups: { id: string; name: string; members: number }[];
  totalActive: number;
}

interface RecipientRow {
  id: string;
  fullName: string;
  email: string;
  acknowledgedAt: string | null;
}

export function AnnouncementsClient({ canPublish }: { canPublish: boolean }) {
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [requiresAck, setRequiresAck] = useState(false);

  const [viewing, setViewing] = useState<AnnouncementRow | null>(null);
  const [recipients, setRecipients] = useState<{
    acknowledged: RecipientRow[];
    outstanding: RecipientRow[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ announcements: AnnouncementRow[] }>("/api/announcements");
      setItems(data.announcements);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useSocketEvent(EVENTS.ANNOUNCEMENT_NEW, () => void load());

  async function openComposer() {
    setOpen(true);
    if (!targets) setTargets(await api<Targets>("/api/messages/broadcast"));
  }

  async function publish() {
    setSaving(true);
    const [kind, value] = audience.split(":");
    try {
      const data = await api<{ recipients: number }>("/api/announcements", {
        method: "POST",
        json: {
          title,
          body,
          audience: kind === "all" ? "ALL" : kind === "role" ? "ROLE" : "GROUP",
          ...(kind === "role" ? { audienceRole: value } : {}),
          ...(kind === "group" ? { audienceGroupId: value } : {}),
          requiresAcknowledgement: requiresAck,
        },
      });
      toast.success(`Published to ${data.recipients} people.`);
      setOpen(false);
      setTitle("");
      setBody("");
      setRequiresAck(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge(a: AnnouncementRow) {
    try {
      await api(`/api/announcements/${a.id}/acknowledge`, { method: "POST" });
      toast.success("Acknowledged.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function viewRecipients(a: AnnouncementRow) {
    setViewing(a);
    setRecipients(null);
    try {
      const data = await api<{
        acknowledged: RecipientRow[];
        outstanding: RecipientRow[];
      }>(`/api/announcements/${a.id}/recipients`);
      setRecipients(data);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function audienceLabel(a: AnnouncementRow) {
    if (a.audience === "ALL") return "Everyone";
    if (a.audience === "ROLE") return `All ${a.audienceRole}`;
    return `Group: ${a.audienceGroup?.name ?? "—"}`;
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        requirement="CM-06"
        description="The audience is fixed when an announcement is published, so the acknowledgement list never changes retroactively as people join or leave."
        action={
          canPublish ? (
            <Button onClick={() => void openComposer()}>New announcement</Button>
          ) : undefined
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState>No announcements yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {a.title}
                    {a.requiresAcknowledgement ? (
                      a.acknowledgedAt ? (
                        <Badge variant="secondary" className="text-[10px]">
                          acknowledged
                        </Badge>
                      ) : (
                        <Badge className="text-[10px]">action required</Badge>
                      )
                    ) : null}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.author.fullName} · {new Date(a.publishedAt).toLocaleString()} ·{" "}
                    {audienceLabel(a)}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  {a.requiresAcknowledgement && !a.acknowledgedAt ? (
                    <Button size="sm" onClick={() => void acknowledge(a)}>
                      Acknowledge
                    </Button>
                  ) : null}
                  {canPublish && a.requiresAcknowledgement ? (
                    <Button size="sm" variant="ghost" onClick={() => void viewRecipients(a)}>
                      {a.acknowledgedCount}/{a.recipientCount}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{a.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* --- composer --- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              Everyone in the audience is notified immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-title">Title</Label>
              <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="a-body">Body</Label>
              <textarea
                id="a-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="a-audience">Audience</Label>
              <NativeSelect
                id="a-audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                <option value="all">Everyone ({targets?.totalActive ?? 0})</option>
                {targets?.roles.map((r) => (
                  <option key={r.name} value={`role:${r.name}`}>
                    All {r.label} ({r.users})
                  </option>
                ))}
                {targets?.groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    Group: {g.name} ({g.members})
                  </option>
                ))}
              </NativeSelect>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={requiresAck}
                onChange={(e) => setRequiresAck(e.target.checked)}
              />
              Require acknowledgement
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void publish()}
              disabled={saving || title.trim() === "" || body.trim() === ""}
            >
              {saving ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- acknowledgement tracking --- */}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledgements</DialogTitle>
            <DialogDescription>{viewing?.title}</DialogDescription>
          </DialogHeader>

          {recipients === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-80 space-y-4 overflow-y-auto">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  Outstanding ({recipients.outstanding.length})
                </p>
                {recipients.outstanding.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Everyone has acknowledged.</p>
                ) : (
                  recipients.outstanding.map((r) => (
                    <p key={r.id} className="py-0.5 text-sm">
                      {r.fullName}
                    </p>
                  ))
                )}
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  Acknowledged ({recipients.acknowledged.length})
                </p>
                {recipients.acknowledged.map((r) => (
                  <p key={r.id} className="py-0.5 text-sm">
                    {r.fullName}{" "}
                    <span className="text-xs text-muted-foreground">
                      {r.acknowledgedAt
                        ? new Date(r.acknowledgedAt).toLocaleString()
                        : null}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
