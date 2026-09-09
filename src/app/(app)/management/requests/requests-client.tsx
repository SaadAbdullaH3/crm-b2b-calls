"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";
import { useSocketEvent } from "@/lib/realtime/use-socket";
import { EVENTS } from "@/lib/realtime/events";

/**
 * LA-03 — Management sees incoming lead requests.
 *
 * Today this is the queue only; approve / reject / modify is Day 4. The live
 * countdown is cosmetic — the server-side job owns the real deadline, so a
 * closed browser tab changes nothing.
 */

interface LeadRequest {
  id: string;
  quantityRequested: number;
  quantityAssigned: number;
  quantitySource: string;
  status: string;
  autoAssignAt: string;
  createdAt: string;
  agent: { id: string; fullName: string; email: string };
  reviewedBy: { id: string; fullName: string } | null;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "default",
  APPROVED: "outline",
  AUTO_ASSIGNED: "outline",
  MODIFIED: "outline",
  REJECTED: "destructive",
  EXPIRED: "secondary",
  CANCELLED: "secondary",
};

function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return <span className="text-muted-foreground">due</span>;
  const total = Math.floor(ms / 1000);
  return (
    <span className="tabular-nums">
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}
    </span>
  );
}

export function RequestsClient() {
  const [requests, setRequests] = useState<LeadRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ requests: LeadRequest[] }>("/api/leads/requests");
      setRequests(data.requests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A new request should appear without a refresh — the whole point of the
  // 5-minute window is that Management can act inside it.
  useSocketEvent(EVENTS.REQUEST_SUBMITTED, () => {
    void load();
  });

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Lead Requests"
        requirement="LA-03"
        description="Requests from agents for more leads. Approving, rejecting and modifying arrive on Day 4 — this is the live queue."
      />

      {pending.length > 0 ? (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
          <strong>{pending.length}</strong> request{pending.length === 1 ? "" : "s"}{" "}
          waiting. Any left un-actioned are assigned automatically by the server.
        </p>
      ) : null}

      <ErrorNote message={error} />

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : requests.length === 0 ? (
        <EmptyState>No lead requests yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Auto-assigns in</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.agent.fullName}</div>
                    <div className="text-xs text-muted-foreground">{r.agent.email}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantityRequested}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.quantitySource.replace(/_/g, " ").toLowerCase()}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {r.status === "PENDING" ? (
                      <Countdown target={r.autoAssignAt} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[r.status] ?? "secondary"}>
                      {r.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
