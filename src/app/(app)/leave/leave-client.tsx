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
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/** HR-05 — request leave, and (for approvers) review it. */

const LEAVE_TYPES = ["ANNUAL", "SICK", "UNPAID", "CASUAL", "BEREAVEMENT", "OTHER"] as const;

type Status = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

interface LeaveRow {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: Status;
  reviewComment: string | null;
  reviewedAt: string | null;
  requester: { id: string; fullName: string; role: { label: string } };
  reviewedBy: { id: string; fullName: string } | null;
}

interface Holiday {
  id: string;
  name: string;
  date: string;
  isRecurring: boolean;
}

const STATUS_STYLE: Record<Status, string> = {
  PENDING: "bg-amber-500 text-white",
  APPROVED: "bg-emerald-600 text-white",
  REJECTED: "bg-destructive text-white",
  CANCELLED: "bg-muted text-muted-foreground",
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function LeaveClient({
  canApprove,
  currentUserId,
}: {
  canApprove: boolean;
  currentUserId: string;
}) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<string>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const [reviewing, setReviewing] = useState<LeaveRow | null>(null);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    try {
      const [leave, hol] = await Promise.all([
        api<{ requests: LeaveRow[] }>(`/api/hr/leave?status=${filter}`),
        api<{ holidays: Holiday[] }>("/api/hr/holidays"),
      ]);
      setRows(leave.requests);
      setHolidays(hol.holidays);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setSaving(true);
    try {
      const data = await api<{ breakdown: { days: number; holidays: string[] } }>(
        "/api/hr/leave",
        { method: "POST", json: { leaveType, startDate, endDate, reason } },
      );
      const skipped =
        data.breakdown.holidays.length > 0
          ? ` (${data.breakdown.holidays.join(", ")} not counted)`
          : "";
      toast.success(`Requested ${data.breakdown.days} working day(s)${skipped}.`);
      setOpen(false);
      setStartDate("");
      setEndDate("");
      setReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function review(decision: "approve" | "reject") {
    if (!reviewing) return;
    setSaving(true);
    try {
      await api(`/api/hr/leave/${reviewing.id}/review`, {
        method: "POST",
        json: { decision, comment },
      });
      toast.success(`Leave ${decision === "approve" ? "approved" : "rejected"}.`);
      setReviewing(null);
      setComment("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const pending = rows.filter((r) => r.status === "PENDING").length;
  const upcoming = holidays
    .filter((h) => h.isRecurring || new Date(h.date) >= new Date())
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title={canApprove ? "Leave Requests" : "My Leave"}
        requirement="HR-05"
        description={
          canApprove
            ? "Weekends and holidays are excluded from the day count automatically, and the count is fixed at submission so editing the calendar later cannot rewrite history."
            : "Request time off. Weekends and public holidays are not counted against your days."
        }
        action={<Button onClick={() => setOpen(true)}>Request leave</Button>}
      />

      <ErrorNote message={error} />

      {upcoming.length > 0 ? (
        <div className="mb-5 rounded-lg border bg-muted/30 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
            Holiday calendar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {upcoming.map((h) => (
              <Badge key={h.id} variant="secondary" className="font-normal">
                {h.name} · {fmt(h.date)}
                {h.isRecurring ? " (yearly)" : ""}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <div className="w-44">
          <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All requests</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </NativeSelect>
        </div>
        {canApprove && pending > 0 ? (
          <Badge className="bg-amber-500 text-white">{pending} awaiting review</Badge>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>No leave requests {filter === "all" ? "yet" : "with that status"}.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                {canApprove ? <TableHead>Employee</TableHead> : null}
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                {canApprove ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  {canApprove ? (
                    <TableCell>
                      <div className="font-medium">{r.requester.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.requester.role.label}
                        {r.requester.id === currentUserId ? " · you" : ""}
                      </div>
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r.leaveType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {fmt(r.startDate)} → {fmt(r.endDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">
                    <div className="line-clamp-2">{r.reason ?? "—"}</div>
                    {r.reviewComment ? (
                      <div className="mt-0.5 line-clamp-2 italic">“{r.reviewComment}”</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                    {r.reviewedBy ? (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        by {r.reviewedBy.fullName}
                      </div>
                    ) : null}
                  </TableCell>
                  {canApprove ? (
                    <TableCell className="text-right">
                      {r.status === "PENDING" ? (
                        <Button size="sm" variant="ghost" onClick={() => setReviewing(r)}>
                          Review
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* --- request --- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request leave</DialogTitle>
            <DialogDescription>
              Only working days are counted — weekends and holidays are skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-type">Type</Label>
              <NativeSelect
                id="l-type"
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="l-start">From</Label>
                <Input
                  id="l-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-end">To</Label>
                <Input
                  id="l-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="l-reason">Reason</Label>
              <textarea
                id="l-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={saving || !startDate || !endDate}
            >
              {saving ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- review --- */}
      <Dialog open={Boolean(reviewing)} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review leave request</DialogTitle>
            <DialogDescription>
              {reviewing
                ? `${reviewing.requester.fullName} — ${reviewing.days} day(s), ${fmt(reviewing.startDate)} to ${fmt(reviewing.endDate)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {reviewing?.reason ? (
            <p className="rounded-md bg-muted p-3 text-sm">{reviewing.reason}</p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="r-comment">Comment</Label>
            <Input
              id="r-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Shown to the requester"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => void review("reject")} disabled={saving}>
              Reject
            </Button>
            <Button onClick={() => void review("approve")} disabled={saving}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
