"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { EVENTS } from "@/lib/realtime/events";
import { useSocketEvent } from "@/lib/realtime/use-socket";
import { Button } from "@/components/ui/button";

/**
 * SRS §15 notification bell, in the shell for every role.
 *
 * Live-updated over Socket.io rather than polled — the same NOTIFICATION_NEW
 * event Dev A's lead-assignment and callback code paths emit through
 * lib/notifications.ts.
 */

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  payload?: { conversationId?: string; announcementId?: string } | null;
}

/** Where clicking a notification should take you. */
function linkFor(n: NotificationRow): string {
  if (n.payload?.conversationId) return `/messages?c=${n.payload.conversationId}`;
  if (n.payload?.announcementId) return "/announcements";
  return "/notifications";
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=12");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      // A failed poll is not worth surfacing — the next event refreshes it.
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <p className="text-sm font-medium">Notifications</p>
              {unread > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => void markAllRead()}>
                  Mark all read
                </Button>
              ) : null}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nothing yet.
                </p>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={linkFor(n)}
                    onClick={() => setOpen(false)}
                    className={`block border-b px-3 py-2 text-sm last:border-0 hover:bg-accent ${
                      n.readAt ? "opacity-60" : ""
                    }`}
                  >
                    <p className="font-medium">{n.title}</p>
                    {n.body ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    ) : null}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
