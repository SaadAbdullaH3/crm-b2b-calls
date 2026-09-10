"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * MG-09 / TM-05 — Management's view of active, idle, break and productivity.
 *
 * This is the ONLY screen in the app allowed to render these numbers. It sits
 * behind `monitoring.view`, which no agent holds, and the API enforces that
 * independently of this page.
 */

type State = "ACTIVE" | "IDLE" | "BREAK" | "ENDED";

interface AgentRow {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: { name: string; label: string };
  };
  activeMs: number;
  idleMs: number;
  breakMs: number;
  screenMs: number;
  idleCount: number;
  breakCount: number;
  state: State;
  firstLoginAt: string;
  lastActivityAt: string;
  isLive: boolean;
  productivityPct: number | null;
}

function hm(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

const STATE_STYLE: Record<State, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-emerald-600 text-white" },
  IDLE: { label: "Idle", className: "bg-amber-500 text-white" },
  BREAK: { label: "On break", className: "bg-sky-600 text-white" },
  ENDED: { label: "Signed out", className: "bg-muted text-muted-foreground" },
};

export function MonitoringClient() {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [scope, setScope] = useState("today");
  const [inactivityMinutes, setInactivity] = useState(5);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<{
        agents: AgentRow[];
        inactivityMinutes: number;
        generatedAt: string;
      }>(`/api/monitoring/live?scope=${scope}`);
      setRows(data.agents);
      setInactivity(data.inactivityMinutes);
      setGeneratedAt(data.generatedAt);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll rather than push: these numbers advance with wall-clock time, not
  // with events, so there is nothing for the server to emit between beats.
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const live = rows.filter((r) => r.isLive);
  const totals = rows.reduce(
    (acc, r) => ({
      active: acc.active + r.activeMs,
      idle: acc.idle + r.idleMs,
      brk: acc.brk + r.breakMs,
    }),
    { active: 0, idle: 0, brk: 0 },
  );

  return (
    <>
      <PageHeader
        title="Agent Monitoring"
        requirement="MG-09 / TM-03"
        description={`Active time stops after ${inactivityMinutes} minute${inactivityMinutes === 1 ? "" : "s"} without input, measured server-side — closing the browser does not keep an agent "active". Change the window in Admin → Time & Breaks.`}
        action={
          <div className="w-44">
            <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="today">Today</option>
              <option value="all">All time</option>
            </NativeSelect>
          </div>
        }
      />

      <ErrorNote message={error} />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Signed in now</p>
            <p className="text-2xl font-semibold">{live.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Total active</p>
            <p className="text-2xl font-semibold">{hm(totals.active)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Total idle</p>
            <p className="text-2xl font-semibold">{hm(totals.idle)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Total break</p>
            <p className="text-2xl font-semibold">{hm(totals.brk)}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>
          Nobody has signed in {scope === "today" ? "today" : "yet"}. Screen time starts at
          login.
        </EmptyState>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Screen</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Idle</TableHead>
                <TableHead className="text-right">Break</TableHead>
                <TableHead className="text-right">Productivity</TableHead>
                <TableHead>First login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const style = STATE_STYLE[r.state];
                return (
                  <TableRow key={r.user.id} className={r.isLive ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="font-medium">{r.user.fullName}</div>
                      <div className="text-xs text-muted-foreground">{r.user.role.label}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={style.className}>{style.label}</Badge>
                      {r.idleCount > 0 ? (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {r.idleCount}× idle
                          {r.breakCount > 0 ? `, ${r.breakCount}× break` : ""}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{hm(r.screenMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hm(r.activeMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hm(r.idleMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hm(r.breakMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.productivityPct === null ? "—" : `${r.productivityPct}%`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.firstLoginAt).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Productivity is active ÷ (active + idle). Break time is excluded from the
        denominator, so a sanctioned break does not read as unproductive.
        {generatedAt ? ` Updated ${new Date(generatedAt).toLocaleTimeString()}.` : ""}
      </p>
    </>
  );
}
