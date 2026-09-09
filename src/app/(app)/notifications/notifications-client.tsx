"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, NativeSelect, EmptyState, api } from "@/components/admin/admin-ui";
import { EVENTS } from "@/lib/realtime/events";
import { useSocketEvent } from "@/lib/realtime/use-socket";

/** SRS §15 — full notification history, the bell's "see all" destination. */

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  payload?: { conversationId?: string; announcementId?: string; leadId?: string } | null;
}

/**
 * Friendly labels for the NOTIFICATION.* keys in lib/notifications.ts.
 * Unknown keys fall back to the raw type rather than being hidden — a
 * notification with no label is a wiring bug worth seeing, not swallowing.
 */
const TYPE_LABELS: Record<string, string> = {
  "lead.batch.assigned": "Leads assigned",
  "lead.request.resolved": "Request resolved",
  "lead.request.submitted": "Request submitted",
  "callback.due": "Callback due",
  "callback.overdue": "Callback overdue",
  "lead.dnc.warning": "Do-Not-Call warning",
  "comms.message": "Message",
  "comms.announcement": "Announcement",
  "hr.notification": "HR",
  "system.alert": "System",
};

/** Where a notification leads. Null means there is nowhere useful to go. */
function linkFor(n: NotificationRow): string | null {
  if (n.payload?.conversationId) return `/messages?c=${n.payload.conversationId}`;
  if (n.payload?.announcementId) return "/announcements";
  return null;
}

export function NotificationsClient() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: NotificationRow[]; unreadCount: number }>(
        "/api/notifications?limit=200",
      );
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useSocketEvent(EVENTS.NOTIFICATION_NEW, () => void load());

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" });
    await load();
  }

  const types = [...new Set(items.map((n) => n.type))].sort();
  const shown =
    filter === "all"
      ? items
      : filter === "unread"
        ? items.filter((n) => !n.readAt)
        : items.filter((n) => n.type === filter);

  return (
    <>
      <PageHeader
        title="Notifications"
        requirement="§15"
        description="Everything the system has sent you, newest first."
        action={
          unread > 0 ? (
            <Button variant="outline" onClick={() => void markAllRead()}>
              Mark all read ({unread})
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 max-w-xs">
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All ({items.length})</option>
          <option value="unread">Unread ({unread})</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </NativeSelect>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState>Nothing here.</EmptyState>
      ) : (
        <div className="divide-y rounded-lg border bg-background">
          {shown.map((n) => {
            const href = linkFor(n);
            const inner = (
              <div className={`px-4 py-3 ${n.readAt ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {TYPE_LABELS[n.type] ?? n.type}
                  </Badge>
                  <span className="text-sm font-medium">{n.title}</span>
                  {!n.readAt ? (
                    <span className="size-1.5 rounded-full bg-primary" aria-label="unread" />
                  ) : null}
                </div>
                {n.body ? (
                  <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            );

            return href ? (
              <Link key={n.id} href={href} className="block hover:bg-accent">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </>
  );
}
