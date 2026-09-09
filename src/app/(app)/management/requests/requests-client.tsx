"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";
import { Countdown } from "@/components/countdown";
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

export function RequestsClient() {
  const [requests, setRequests] = useState<LeadRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-row quantity override, so "modify" is just approving a different number. */
  const [amounts, setAmounts] = useState<Record<string, string>>({});

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

  // Also refresh when the auto-assign job resolves one, so a request doesn't
  // sit on screen showing Approve buttons that will now fail.
  useSocketEvent(EVENTS.REQUEST_RESOLVED, () => {
    void load();
  });

  const pending = requests.filter((r) => r.status === "PENDING");

  async function resolve(id: string, action: "APPROVE" | "REJECT") {
    setBusyId(id);
    setError(null);
    try {
      const raw = amounts[id];
      const quantity = action === "APPROVE" && raw ? Number(raw) : undefined;
      if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
        setError("Quantity must be a whole number of at least 1.");
        return;
      }

      const res = await api<{ assigned: number }>(
        `/api/leads/requests/${id}/resolve`,
        { method: "POST", json: { action, ...(quantity ? { quantity } : {}) } },
      );

      toast.success(
        action === "REJECT"
          ? "Request rejected."
          : `Assigned ${res.assigned} lead${res.assigned === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (e) {
      // The most likely failure is the auto-assign job having claimed it first,
      // which the API reports explicitly rather than silently double-assigning.
      setError(e instanceof Error ? e.message : "Could not action that request.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Lead Requests"
        requirement="LA-03"
        description="Approve, reject, or change the quantity. Anything left un-actioned is assigned automatically by the server when its countdown runs out."
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
                <TableHead className="w-72">Action</TableHead>
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
                  <TableCell>
                    {r.status === "PENDING" ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          aria-label={`Quantity to assign to ${r.agent.fullName}`}
                          placeholder={String(r.quantityRequested)}
                          value={amounts[r.id] ?? ""}
                          onChange={(e) =>
                            setAmounts((a) => ({ ...a, [r.id]: e.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => resolve(r.id, "APPROVE")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => resolve(r.id, "REJECT")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.quantityAssigned > 0
                          ? `${r.quantityAssigned} assigned`
                          : "—"}
                        {r.reviewedBy ? ` · ${r.reviewedBy.fullName}` : ""}
                      </span>
                    )}
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
