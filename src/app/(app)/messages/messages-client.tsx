"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

/** CM-01/02/04/05/07 — inbox, thread, new conversation, broadcast. */

interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  role: { name: string; label: string };
}

interface ConversationRow {
  id: string;
  type: "DIRECT" | "GROUP" | "BROADCAST";
  title: string;
  group: { id: string; name: string } | null;
  participants: { id: string; fullName: string }[];
  lastMessage: { body: string; sentAt: string; senderId: string } | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface MessageRow {
  id: string;
  body: string;
  sentAt: string;
  senderId: string;
  sender: { id: string; fullName: string };
}

interface BroadcastTargets {
  roles: { name: string; label: string; users: number }[];
  groups: { id: string; name: string; members: number }[];
  totalActive: number;
}

export function MessagesClient({
  currentUserId,
  canBroadcast,
}: {
  currentUserId: string;
  canBroadcast: boolean;
}) {
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [activeTitle, setActiveTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [newUserId, setNewUserId] = useState("");

  const [castOpen, setCastOpen] = useState(false);
  const [targets, setTargets] = useState<BroadcastTargets | null>(null);
  const [castTarget, setCastTarget] = useState("all");
  const [castBody, setCastBody] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api<{ conversations: ConversationRow[] }>(
        "/api/messages/conversations",
      );
      setConversations(data.conversations);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const openConversation = useCallback(
    async (id: string, q?: string) => {
      setActiveId(id);
      try {
        const url = q
          ? `/api/messages/conversations/${id}?q=${encodeURIComponent(q)}`
          : `/api/messages/conversations/${id}`;
        const data = await api<{
          conversation: { title: string };
          messages: MessageRow[];
        }>(url);
        setMessages(data.messages);
        setActiveTitle(data.conversation.title);

        // Only clear unread on an unfiltered read — a search result isn't
        // proof the user saw everything in the thread.
        if (!q) {
          await fetch(`/api/messages/conversations/${id}/read`, { method: "POST" });
          await loadConversations();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [loadConversations],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Deep link from a notification: /messages?c=<id>
  useEffect(() => {
    const c = searchParams.get("c");
    if (c) void openConversation(c);
  }, [searchParams, openConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useSocketEvent<{ conversationId: string }>(EVENTS.MESSAGE_NEW, (payload) => {
    void loadConversations();
    if (payload.conversationId === activeId) void openConversation(activeId);
  });

  async function send() {
    if (!activeId || draft.trim() === "") return;
    setSending(true);
    try {
      await api(`/api/messages/conversations/${activeId}`, {
        method: "POST",
        json: { body: draft },
      });
      setDraft("");
      await openConversation(activeId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function openNew() {
    setNewOpen(true);
    if (directory.length === 0) {
      const data = await api<{ users: DirectoryUser[] }>("/api/messages/directory");
      setDirectory(data.users);
      setNewUserId(data.users[0]?.id ?? "");
    }
  }

  async function startConversation() {
    try {
      const data = await api<{ conversationId: string }>("/api/messages/conversations", {
        method: "POST",
        json: { type: "DIRECT", userId: newUserId },
      });
      setNewOpen(false);
      await loadConversations();
      await openConversation(data.conversationId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function openBroadcast() {
    setCastOpen(true);
    if (!targets) setTargets(await api<BroadcastTargets>("/api/messages/broadcast"));
  }

  async function sendBroadcast() {
    setSending(true);
    const [kind, value] = castTarget.split(":");
    try {
      const data = await api<{ delivered: number }>("/api/messages/broadcast", {
        method: "POST",
        json: {
          target: kind,
          ...(kind === "role" ? { roleName: value } : {}),
          ...(kind === "group" ? { groupId: value } : {}),
          body: castBody,
        },
      });
      toast.success(`Delivered to ${data.delivered} ${data.delivered === 1 ? "person" : "people"}.`);
      setCastOpen(false);
      setCastBody("");
      await loadConversations();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Messages"
        requirement="CM-01"
        description="Direct and group messages. Broadcasts are delivered as individual conversations, so replies come back only to the sender."
        action={
          <div className="flex gap-2">
            {canBroadcast ? (
              <Button variant="outline" onClick={() => void openBroadcast()}>
                Broadcast
              </Button>
            ) : null}
            <Button onClick={() => void openNew()}>New message</Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* --- inbox --- */}
        <div className="rounded-lg border bg-background">
          <div className="border-b p-2">
            <Input
              placeholder="Search this conversation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && activeId) void openConversation(activeId, search);
              }}
            />
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet.
              </p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void openConversation(c.id)}
                  className={`flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-0 hover:bg-accent ${
                    activeId === c.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    {c.unreadCount > 0 ? (
                      <Badge className="shrink-0 px-1.5 text-[10px]">{c.unreadCount}</Badge>
                    ) : null}
                  </div>
                  {c.lastMessage ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {c.lastMessage.body}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        {/* --- thread --- */}
        <div className="flex min-h-[65vh] flex-col rounded-lg border bg-background">
          {activeId ? (
            <>
              <div className="border-b px-4 py-2.5">
                <p className="text-sm font-medium">{activeTitle}</p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => {
                  const mine = m.senderId === currentUserId;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          mine ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {!mine ? (
                          <p className="mb-0.5 text-xs font-medium opacity-70">
                            {m.sender.fullName}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="mt-1 text-[10px] opacity-60">
                          {new Date(m.sentAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="flex gap-2 border-t p-3">
                <Input
                  placeholder="Write a message…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button onClick={() => void send()} disabled={sending || draft.trim() === ""}>
                  Send
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState>Pick a conversation, or start a new one.</EmptyState>
            </div>
          )}
        </div>
      </div>

      {/* --- new conversation --- */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Opens your existing thread with that person if one already exists.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <NativeSelect
              id="to"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
            >
              {directory.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} — {u.role.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void startConversation()} disabled={!newUserId}>
              Start conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- broadcast --- */}
      <Dialog open={castOpen} onOpenChange={setCastOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Broadcast</DialogTitle>
            <DialogDescription>
              Each recipient gets this as a private conversation with you — replies
              come back to you alone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cast-target">Send to</Label>
              <NativeSelect
                id="cast-target"
                value={castTarget}
                onChange={(e) => setCastTarget(e.target.value)}
              >
                <option value="all">Everyone ({targets?.totalActive ?? 0} active)</option>
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

            <div className="space-y-1.5">
              <Label htmlFor="cast-body">Message</Label>
              <textarea
                id="cast-body"
                rows={5}
                value={castBody}
                onChange={(e) => setCastBody(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCastOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void sendBroadcast()}
              disabled={sending || castBody.trim() === ""}
            >
              {sending ? "Sending…" : "Send broadcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
