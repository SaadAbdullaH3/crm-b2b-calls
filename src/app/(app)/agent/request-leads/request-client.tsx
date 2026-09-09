"use client";

import { useCallback, useEffect, useState } from "react";
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
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * LA-02 / LA-03 — an agent requests more leads.
 *
 * The preset buttons fill the quantity field rather than submitting directly,
 * which is what the SRS describes: presets are a shortcut into the same field,
 * so the agent can still adjust before sending.
 *
 * The countdown shown here is COSMETIC. The real deadline is `autoAssignAt` on
 * the request row, and the server-side job (Day 4) is what actually assigns —
 * closing this tab does not stop it.
 */

const PRESETS = [15, 30];

interface LeadRequest {
  id: string;
  quantityRequested: number;
  quantityApproved: number | null;
  quantityAssigned: number;
  quantitySource: string;
  status: string;
  autoAssignAt: string;
  createdAt: string;
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
  if (ms <= 0) return <span className="text-muted-foreground">assigning…</span>;

  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (
    <span className="tabular-nums">
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

export function RequestLeadsClient() {
  const [quantity, setQuantity] = useState<string>("15");
  const [requests, setRequests] = useState<LeadRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ requests: LeadRequest[] }>(
        "/api/leads/requests?scope=mine",
      );
      setRequests(data.requests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = requests.find((r) => r.status === "PENDING");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(quantity);
    if (!Number.isInteger(n) || n < 1) {
      setError("Enter a whole number of leads.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api("/api/leads/requests", { method: "POST", json: { quantity: n } });
      toast.success(`Requested ${n} leads. Management has been notified.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Request Leads"
        requirement="LA-02"
        description="Ask Management for another batch of leads to call."
      />

      <form onSubmit={submit} className="mb-8 space-y-4 rounded-lg border bg-background p-5">
        <div className="space-y-2">
          <Label>Quantity</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((n) => (
              <Button
                key={n}
                type="button"
                variant={quantity === String(n) ? "default" : "outline"}
                onClick={() => setQuantity(String(n))}
                disabled={Boolean(pending)}
              >
                {n}
              </Button>
            ))}
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={Boolean(pending)}
              className="w-28"
              aria-label="Custom quantity"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Use a preset or type any amount.
          </p>
        </div>

        <ErrorNote message={error} />

        {pending ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            You have a request for <strong>{pending.quantityRequested}</strong> leads
            waiting. It assigns automatically in{" "}
            <strong>
              <Countdown target={pending.autoAssignAt} />
            </strong>{" "}
            if Management doesn&apos;t action it first.
          </p>
        ) : (
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending..." : "Request leads"}
          </Button>
        )}
      </form>

      <h2 className="mb-3 text-sm font-semibold">Your requests</h2>

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : requests.length === 0 ? (
        <EmptyState>You haven&apos;t requested any leads yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actioned by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantityRequested}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantityAssigned || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[r.status] ?? "secondary"}>
                      {r.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.reviewedBy?.fullName ?? "—"}
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
