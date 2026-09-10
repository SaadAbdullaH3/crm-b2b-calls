"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
 * CL-07 — the callback / task view.
 *
 * Four buckets, worst-first: overdue, due today, upcoming, completed. Buckets
 * are computed server-side from `scheduled_for`, so a callback moves between
 * them with the clock rather than needing anything to run.
 */

interface CallbackRow {
  id: string;
  scheduledFor: string;
  status: string;
  notes: string | null;
  completedAt: string | null;
  lead: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    phoneE164: string | null;
    phoneRaw: string | null;
    doNotCall: boolean;
  };
}

type Bucket = "overdue" | "due" | "upcoming" | "completed";

const BUCKETS: { key: Bucket; label: string; tone: "destructive" | "default" | "secondary" | "outline" }[] = [
  { key: "overdue", label: "Overdue", tone: "destructive" },
  { key: "due", label: "Due today", tone: "default" },
  { key: "upcoming", label: "Upcoming", tone: "secondary" },
  { key: "completed", label: "Completed", tone: "outline" },
];

export function CallbacksClient() {
  const [data, setData] = useState<Record<Bucket, CallbackRow[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ callbacks: Record<Bucket, CallbackRow[]> }>(
        "/api/callbacks",
      );
      setData(res.callbacks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your callbacks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(id: string, body: Record<string, unknown>, message: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/callbacks/${id}`, { method: "PATCH", json: body });
      toast.success(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that callback.");
    } finally {
      setBusy(null);
    }
  }

  function reschedule(id: string) {
    const input = window.prompt(
      "New date and time (YYYY-MM-DD HH:MM)",
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " "),
    );
    if (!input) return;
    const when = new Date(input.replace(" ", "T"));
    if (Number.isNaN(when.getTime())) {
      setError("Could not read that date. Use YYYY-MM-DD HH:MM.");
      return;
    }
    void update(
      id,
      { scheduledFor: when.toISOString(), status: "SCHEDULED" },
      `Rescheduled for ${when.toLocaleString()}.`,
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Callbacks"
        requirement="CL-07"
        description="Every callback you promised, worst-first. Reminders fire from the server, so you get them whether or not this tab is open."
      />

      <ErrorNote message={error} />

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : !data ? null : BUCKETS.every((b) => data[b.key].length === 0) ? (
        <EmptyState>
          No callbacks scheduled. They appear here when you save a Call Back Later
          outcome.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {BUCKETS.map(({ key, label, tone }) => {
            const rows = data[key];
            if (rows.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  {label}
                  <Badge variant={tone}>{rows.length}</Badge>
                </h2>
                <div className="overflow-x-auto rounded-lg border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Scheduled</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-56">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((cb) => (
                        <TableRow key={cb.id}>
                          <TableCell>
                            <div className="font-medium">
                              {cb.lead.companyName ?? cb.lead.contactName ?? "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {cb.lead.contactName ?? ""}
                              {cb.status === "MISSED" ? " · missed" : ""}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cb.lead.phoneRaw ?? cb.lead.phoneE164 ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {new Date(cb.scheduledFor).toLocaleString()}
                            {cb.completedAt ? (
                              <div className="text-xs text-muted-foreground">
                                done {new Date(cb.completedAt).toLocaleString()}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">
                            {cb.notes ?? "—"}
                          </TableCell>
                          <TableCell>
                            {key === "completed" ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  disabled={busy === cb.id}
                                  onClick={() =>
                                    update(cb.id, { status: "COMPLETED" }, "Marked done.")
                                  }
                                >
                                  Done
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy === cb.id}
                                  onClick={() => reschedule(cb.id)}
                                >
                                  Reschedule
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy === cb.id}
                                  onClick={() =>
                                    update(cb.id, { status: "CANCELLED" }, "Cancelled.")
                                  }
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
