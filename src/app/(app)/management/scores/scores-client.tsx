"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

/**
 * RP-03 — Management Score: enter, adjust, approve, and see every change.
 *
 * The history panel is not decoration. "Editable with an audit trail" is the
 * requirement, and an audit trail nobody can read is indistinguishable from no
 * audit trail — so every change, its reason and its author are on the screen
 * next to the number, not only in the database.
 */

interface Person {
  id: string;
  fullName: string;
  email?: string;
}

interface ScoreRow {
  id: string;
  subject: Person;
  author: Person;
  periodStart: string;
  periodEnd: string;
  score: number;
  notes: string | null;
  status: "DRAFT" | "APPROVED";
  version: number;
  approvedBy: Person | null;
  approvedAt: string | null;
  changeCount: number;
  updatedAt: string;
}

interface HistoryEvent {
  id: string;
  type: "CREATED" | "UPDATED" | "APPROVED" | "REOPENED";
  actor: string;
  fromScore: number | null;
  toScore: number | null;
  reason: string;
  at: string;
}

const EVENT_TEXT: Record<HistoryEvent["type"], string> = {
  CREATED: "Score recorded",
  UPDATED: "Score changed",
  APPROVED: "Approved",
  REOPENED: "Reopened for editing",
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** Last calendar month, the period a score is most often recorded against. */
function lastMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}

export function ScoresClient({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [agents, setAgents] = useState<Person[]>([]);
  const [bounds, setBounds] = useState({ min: 0, max: 100 });
  const [subjectId, setSubjectId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaults = lastMonthRange();
  const [form, setForm] = useState({
    subjectId: "",
    periodStart: defaults.from,
    periodEnd: defaults.to,
    score: "80",
    notes: "",
    reason: "",
  });
  const [edit, setEdit] = useState({ score: "", notes: "", reason: "" });
  const [decisionReason, setDecisionReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (subjectId) params.set("subjectId", subjectId);
      if (status) params.set("status", status);
      const data = await api<{
        scores: ScoreRow[];
        agents: Person[];
        bounds: { min: number; max: number };
      }>(`/api/reports/scores?${params.toString()}`);
      setRows(data.scores);
      setAgents(data.agents);
      setBounds(data.bounds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load scores.");
    } finally {
      setLoading(false);
    }
  }, [subjectId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHistory = async (row: ScoreRow) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    setEdit({ score: String(row.score), notes: row.notes ?? "", reason: "" });
    setDecisionReason("");
    setHistoryLoading(true);
    try {
      const data = await api<{ history: HistoryEvent[] }>(`/api/reports/scores/${row.id}`);
      setHistory(data.history);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the change history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await api("/api/reports/scores", {
        method: "POST",
        json: {
          subjectId: form.subjectId,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          score: Number(form.score),
          notes: form.notes || null,
          reason: form.reason,
        },
      });
      toast.success("Score recorded");
      setCreating(false);
      setForm((f) => ({ ...f, subjectId: "", notes: "", reason: "" }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the score.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (row: ScoreRow) => {
    setBusy(true);
    try {
      await api(`/api/reports/scores/${row.id}`, {
        method: "PATCH",
        json: {
          score: Number(edit.score),
          notes: edit.notes || null,
          reason: edit.reason,
        },
      });
      toast.success("Score updated");
      setEdit((e) => ({ ...e, reason: "" }));
      await load();
      const data = await api<{ history: HistoryEvent[] }>(`/api/reports/scores/${row.id}`);
      setHistory(data.history);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the score.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (row: ScoreRow, action: "approve" | "reopen") => {
    setBusy(true);
    try {
      await api(`/api/reports/scores/${row.id}/decision`, {
        method: "POST",
        json: { action, reason: decisionReason },
      });
      toast.success(action === "approve" ? "Score approved" : "Score reopened");
      setDecisionReason("");
      await load();
      const data = await api<{ history: HistoryEvent[] }>(`/api/reports/scores/${row.id}`);
      setHistory(data.history);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Management Scores"
        requirement="RP-03"
        description="A score can be changed, but never quietly: every change carries a reason and is kept. Approving freezes it until someone deliberately reopens it."
        action={
          <div className="flex gap-2">
            <Link href="/management/reports">
              <Button variant="outline" size="sm">
                Back to reports
              </Button>
            </Link>
            {canManage ? (
              <Button size="sm" onClick={() => setCreating((v) => !v)}>
                {creating ? "Cancel" : "New score"}
              </Button>
            ) : null}
          </div>
        }
      />

      {creating ? (
        <div className="mb-5 rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium">Record a score</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Agent</span>
              <NativeSelect
                value={form.subjectId}
                onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
              >
                <option value="">Choose an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Period start</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Period end</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">
                Score ({bounds.min}–{bounds.max})
              </span>
              <input
                type="number"
                min={bounds.min}
                max={bounds.max}
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.score}
                onChange={(e) => setForm({ ...form, score: e.target.value })}
              />
            </label>
            <label className="text-xs md:col-span-2">
              <span className="mb-1 block text-muted-foreground">Notes (optional)</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="What this score reflects"
              />
            </label>
            <label className="text-xs md:col-span-3">
              <span className="mb-1 block text-muted-foreground">
                Reason — required, and kept in the history
              </span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Why this score, in a sentence"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={busy || !form.subjectId || form.reason.trim().length < 5}
              onClick={() => void create()}
            >
              Save score
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Agent</span>
          <NativeSelect
            className="w-48"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Status</span>
          <NativeSelect className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
          </NativeSelect>
        </label>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>
          No scores yet. Look at the raw data and the performance report first — the SRS asks for
          the numbers before the judgement.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border">
              <button
                className="flex w-full items-center gap-4 px-4 py-3 text-left"
                onClick={() => void openHistory(row)}
              >
                <div className="w-14 text-2xl font-semibold tabular-nums">{row.score}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.subject.fullName}</div>
                  <div className="text-xs text-muted-foreground">
                    {day(row.periodStart)} → {day(row.periodEnd)} · recorded by {row.author.fullName}
                    {row.changeCount > 1 ? ` · ${row.changeCount} changes` : ""}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    row.status === "APPROVED"
                      ? "bg-foreground/10 text-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.status === "APPROVED"
                    ? `Approved by ${row.approvedBy?.fullName ?? "—"}`
                    : "Draft"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {openId === row.id ? "Hide" : "History"}
                </span>
              </button>

              {openId === row.id ? (
                <div className="border-t px-4 py-3">
                  {row.notes ? (
                    <p className="mb-3 text-sm">
                      <span className="text-muted-foreground">Notes: </span>
                      {row.notes}
                    </p>
                  ) : null}

                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                    Change history — append-only
                  </h3>
                  {historyLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <ol className="mb-4 space-y-2">
                      {history.map((e) => (
                        <li key={e.id} className="border-l-2 pl-3 text-sm">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium">{EVENT_TEXT[e.type]}</span>
                            {e.fromScore !== null && e.toScore !== null && e.fromScore !== e.toScore ? (
                              <span className="tabular-nums text-muted-foreground">
                                {e.fromScore} → {e.toScore}
                              </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              {e.actor} · {when(e.at)}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">{e.reason}</div>
                        </li>
                      ))}
                    </ol>
                  )}

                  {canManage ? (
                    row.status === "DRAFT" ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 md:grid-cols-4">
                          <label className="text-xs">
                            <span className="mb-1 block text-muted-foreground">Score</span>
                            <input
                              type="number"
                              min={bounds.min}
                              max={bounds.max}
                              className="h-9 w-full rounded-md border px-3 text-sm"
                              value={edit.score}
                              onChange={(e) => setEdit({ ...edit, score: e.target.value })}
                            />
                          </label>
                          <label className="text-xs md:col-span-3">
                            <span className="mb-1 block text-muted-foreground">Notes</span>
                            <input
                              className="h-9 w-full rounded-md border px-3 text-sm"
                              value={edit.notes}
                              onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                            />
                          </label>
                          <label className="text-xs md:col-span-4">
                            <span className="mb-1 block text-muted-foreground">
                              Reason for the change — required
                            </span>
                            <input
                              className="h-9 w-full rounded-md border px-3 text-sm"
                              value={edit.reason}
                              onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || edit.reason.trim().length < 5}
                            onClick={() => void saveEdit(row)}
                          >
                            Save change
                          </Button>
                          <label className="text-xs">
                            <span className="mb-1 block text-muted-foreground">
                              Approval reason
                            </span>
                            <input
                              className="h-9 w-72 rounded-md border px-3 text-sm"
                              value={decisionReason}
                              onChange={(e) => setDecisionReason(e.target.value)}
                              placeholder="Why this score is being approved"
                            />
                          </label>
                          <Button
                            size="sm"
                            disabled={busy || decisionReason.trim().length < 5}
                            onClick={() => void decide(row, "approve")}
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs">
                          <span className="mb-1 block text-muted-foreground">
                            Reason for reopening — required
                          </span>
                          <input
                            className="h-9 w-72 rounded-md border px-3 text-sm"
                            value={decisionReason}
                            onChange={(e) => setDecisionReason(e.target.value)}
                          />
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || decisionReason.trim().length < 5}
                          onClick={() => void decide(row, "reopen")}
                        >
                          Reopen
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          An approved score cannot be edited in place. Reopening is deliberate, and
                          is itself recorded.
                        </p>
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
