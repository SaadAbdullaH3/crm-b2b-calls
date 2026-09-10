"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  PageHeader,
  NativeSelect,
  EmptyState,
  ErrorNote,
  api,
} from "@/components/admin/admin-ui";

/**
 * LA-06 / LA-07 / LA-08 — manual assignment, transfer, reassignment and release.
 *
 * Deliberately a working minimum for Day 4: select leads, hand them to an agent
 * or return them to the pool. The richer lead browser, timeline (SF-03) and
 * assignment history (SF-04) are Day 6 and grow out of this screen.
 *
 * Every action here goes through the same transactional primitive the
 * auto-assign job uses, so a manual transfer cannot race a pool claim.
 */

interface Lead {
  id: string;
  companyName: string | null;
  contactName: string | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  email: string | null;
  status: string;
  sourceLabel: string | null;
  doNotCall: boolean;
  lastDispositionCode: string | null;
  assignedTo: { id: string; fullName: string } | null;
}

interface AgentOption {
  id: string;
  fullName: string;
  currentLeadCount: number;
}

const STATUSES = [
  "",
  "AVAILABLE",
  "ASSIGNED",
  "IN_PROGRESS",
  "CALLBACK_SCHEDULED",
  "CLOSED_QUALIFIED",
  "CLOSED_NOT_INTERESTED",
  "DO_NOT_CALL",
];

export function ManagementLeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [targetAgent, setTargetAgent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());

      const data = await api<{ leads: Lead[]; total: number }>(
        `/api/leads?${params.toString()}`,
      );
      setLeads(data.leads);
      setTotal(data.total);
      setSelected(new Set());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  // /api/leads/agents, not Dev B's /api/admin/users: Management runs assignment
  // but does not hold admin.users.manage, so the admin route 403s for them.
  useEffect(() => {
    api<{ agents: AgentOption[] }>("/api/leads/agents")
      .then((d) => setAgents(d.agents))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load the agent list."),
      );
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (!targetAgent) {
      setError("Choose an agent first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ assigned: number; skipped: { reason: string }[] }>(
        "/api/leads/assign",
        { method: "POST", json: { leadIds: [...selected], agentId: targetAgent } },
      );
      toast.success(`Assigned ${res.assigned} lead${res.assigned === 1 ? "" : "s"}.`);
      if (res.skipped.length) {
        const reasons = [...new Set(res.skipped.map((s) => s.reason))].join(", ");
        toast.warning(`${res.skipped.length} skipped (${reasons.toLowerCase()}).`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ released: number }>("/api/leads/release", {
        method: "POST",
        json: { leadIds: [...selected] },
      });
      toast.success(
        `Returned ${res.released} lead${res.released === 1 ? "" : "s"} to the pool.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="All Leads"
        requirement="LA-06"
        description="Assign, transfer or release leads directly. Every change is written to the assignment history — nothing is overwritten."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="q">
            Search
          </label>
          <Input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company, contact, phone, email"
            className="w-64"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="status">
            Status
          </label>
          <NativeSelect
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-52"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, " ").toLowerCase() : "All statuses"}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-muted px-3 py-2">
          <span className="text-sm">
            <strong>{selected.size}</strong> selected
          </span>
          <NativeSelect
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            className="w-52"
            aria-label="Assign to agent"
          >
            <option value="">Assign to…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName} ({a.currentLeadCount})
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" disabled={busy || !targetAgent} onClick={assign}>
            Assign / transfer
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={release}>
            Return to pool
          </Button>
        </div>
      ) : null}

      <ErrorNote message={error} />

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : leads.length === 0 ? (
        <EmptyState>No leads match those filters.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={selected.size === leads.length && leads.length > 0}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(leads.map((l) => l.id)) : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${lead.companyName ?? lead.id}`}
                      checked={selected.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/management/leads/${lead.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {lead.companyName ?? lead.contactName ?? lead.id}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {lead.contactName ?? "—"}
                    </div>
                    {lead.doNotCall ? (
                      <Badge variant="destructive" className="mt-1">
                        Do Not Call
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {lead.phoneE164 ?? lead.phoneRaw ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {lead.assignedTo?.fullName ?? (
                      <span className="text-muted-foreground">unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={lead.doNotCall ? "destructive" : "secondary"}>
                      {lead.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    {lead.lastDispositionCode ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {lead.lastDispositionCode.replace(/_/g, " ").toLowerCase()}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {lead.sourceLabel ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {leads.length.toLocaleString()} of {total.toLocaleString()}.
      </p>
    </div>
  );
}
