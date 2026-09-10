"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { EVENTS } from "@/lib/realtime/events";
import { useSocketEvent } from "@/lib/realtime/use-socket";

/** SRS §8.1 — operations overview, source performance, per-agent results. */

type State = "ACTIVE" | "IDLE" | "BREAK" | "ENDED";

interface AgentRow {
  agentId: string;
  fullName: string;
  leadsHeld: number;
  calls: number;
  totalTalkSec: number;
  avgTalkSec: number;
  noAnswer: number;
  callBackLater: number;
  notInterested: number;
  doNotCall: number;
  email_: number;
  qualified: number;
  pendingCallbacks: number;
  overdueCallbacks: number;
  monitoring?: {
    state: State | null;
    activeMs: number;
    idleMs: number;
    breakMs: number;
    productivityPct: number | null;
  };
}

interface Payload {
  scope: string;
  canSeeMonitoring: boolean;
  leads: {
    pipeline: {
      total: number;
      available: number;
      assigned: number;
      doNotCall: number;
    };
    inRange: { imported: number; worked: number; qualified: number };
  };
  sources: {
    source: string;
    imported: number;
    worked: number;
    qualified: number;
    notInterested: number;
    doNotCall: number;
    conversionPct: number | null;
  }[];
  agents: AgentRow[];
  outcomes: {
    totalCalls: number;
    totalTalkSec: number;
    byCode: { code: string; count: number }[];
    undispositioned: number;
  };
  pendingRequests: number;
  generatedAt: string;
}

function hm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function hmFromMs(ms: number): string {
  return hm(Math.floor(ms / 1000));
}

const STATE_STYLE: Record<State, string> = {
  ACTIVE: "bg-emerald-600 text-white",
  IDLE: "bg-amber-500 text-white",
  BREAK: "bg-sky-600 text-white",
  ENDED: "bg-muted text-muted-foreground",
};

const OUTCOME_LABEL: Record<string, string> = {
  NO_ANSWER: "No answer",
  CALL_BACK_LATER: "Call back",
  NOT_INTERESTED: "Not interested",
  DO_NOT_CALL: "Do not call",
  EMAIL: "Email",
  QUALIFIED: "Qualified",
};

export function DashboardClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [scope, setScope] = useState("today");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>(`/api/management/dashboard?scope=${scope}`));
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

  // Lead movement is event-driven, so refresh on Dev A's assignment events
  // rather than polling for something that changes a few times an hour.
  useSocketEvent(EVENTS.LEAD_ASSIGNED, () => void load());
  useSocketEvent(EVENTS.REQUEST_SUBMITTED, () => void load());
  useSocketEvent(EVENTS.REQUEST_RESOLVED, () => void load());

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <ErrorNote message={error} />;

  const { leads, outcomes } = data;
  const { pipeline, inRange } = leads;
  const scopeLabel =
    { today: "today", "7d": "last 7 days", "30d": "last 30 days", all: "all time" }[
      data.scope
    ] ?? data.scope;

  return (
    <>
      <PageHeader
        title="Management Console"
        requirement="§8.1"
        description="Lead pipeline, source performance and per-agent results."
        action={
          <div className="flex items-center gap-2">
            {data.pendingRequests > 0 ? (
              <Link href="/management/requests">
                <Button variant="outline" size="sm">
                  {data.pendingRequests} request
                  {data.pendingRequests === 1 ? "" : "s"} waiting
                </Button>
              </Link>
            ) : null}
            <div className="w-36">
              <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </NativeSelect>
            </div>
          </div>
        }
      />

      <ErrorNote message={error} />

      {/* --- lead pipeline --------------------------------------------- */}
      {/* Two groups, labelled. Pipeline is where leads stand RIGHT NOW and does
          not move with the scope selector; activity does. Showing them as one
          undifferentiated block invited "total leads 120" to be read as
          "120 arrived today". */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pipeline now
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total leads", value: pipeline.total },
          { label: "Available", value: pipeline.available },
          { label: "Assigned", value: pipeline.assigned },
          { label: "Do not call", value: pipeline.doNotCall },
        ].map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Activity — {scopeLabel}
      </p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Imported", value: inRange.imported },
          { label: "Worked", value: inRange.worked },
          { label: "Qualified", value: inRange.qualified },
          { label: "Calls", value: outcomes.totalCalls },
        ].map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- call outcome mix ------------------------------------------ */}
      <div className="mb-6 rounded-lg border bg-background p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Call outcomes</h2>
          <p className="text-xs text-muted-foreground">
            {outcomes.totalCalls} call{outcomes.totalCalls === 1 ? "" : "s"} ·{" "}
            {hm(outcomes.totalTalkSec)} total talk time
          </p>
        </div>
        {outcomes.totalCalls === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calls in this period. Calls appear once agents start recording dispositions.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {outcomes.byCode.map((o) => (
              <div key={o.code}>
                <p className="text-xs text-muted-foreground">
                  {OUTCOME_LABEL[o.code] ?? o.code}
                </p>
                <p className="text-lg font-semibold tabular-nums">{o.count}</p>
              </div>
            ))}
            {/* Shown only when non-zero, but it MUST be shown when it is:
                otherwise the buckets sum to less than the call total and the
                panel silently fails to add up. */}
            {outcomes.undispositioned > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">No outcome yet</p>
                <p className="text-lg font-semibold tabular-nums">
                  {outcomes.undispositioned}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* --- per agent -------------------------------------------------- */}
      <h2 className="mb-2 text-base font-semibold">By agent</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Click a row for the full drill-down (MG-05).
        {!data.canSeeMonitoring
          ? " Active/idle metrics are hidden — you do not hold monitoring.view."
          : ""}
      </p>

      <div className="mb-6 overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              {data.canSeeMonitoring ? <TableHead>State</TableHead> : null}
              <TableHead className="text-right">Held</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Talk</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">No ans.</TableHead>
              <TableHead className="text-right">Callback</TableHead>
              <TableHead className="text-right">Qualified</TableHead>
              {data.canSeeMonitoring ? <TableHead className="text-right">Prod.</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.agents.map((a) => (
              <TableRow key={a.agentId} className="cursor-pointer">
                <TableCell>
                  <Link
                    href={`/management/agents/${a.agentId}`}
                    className="font-medium hover:underline"
                  >
                    {a.fullName}
                  </Link>
                  {a.overdueCallbacks > 0 ? (
                    <div className="text-[10px] text-destructive">
                      {a.overdueCallbacks} overdue callback
                      {a.overdueCallbacks === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </TableCell>
                {data.canSeeMonitoring ? (
                  <TableCell>
                    {a.monitoring?.state ? (
                      <Badge className={STATE_STYLE[a.monitoring.state]}>
                        {a.monitoring.state === "ENDED" ? "Signed out" : a.monitoring.state}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{a.leadsHeld}</TableCell>
                <TableCell className="text-right tabular-nums">{a.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{hm(a.totalTalkSec)}</TableCell>
                <TableCell className="text-right tabular-nums">{hm(a.avgTalkSec)}</TableCell>
                <TableCell className="text-right tabular-nums">{a.noAnswer}</TableCell>
                <TableCell className="text-right tabular-nums">{a.callBackLater}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {a.qualified}
                </TableCell>
                {data.canSeeMonitoring ? (
                  <TableCell className="text-right tabular-nums">
                    {a.monitoring?.productivityPct === null ||
                    a.monitoring?.productivityPct === undefined
                      ? "—"
                      : `${a.monitoring.productivityPct}%`}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* --- source performance ---------------------------------------- */}
      <h2 className="mb-2 text-base font-semibold">By lead source</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        <strong>Imported</strong> is each source&apos;s whole book, all time.{" "}
        <strong>Worked</strong>, <strong>Qualified</strong> and{" "}
        <strong>Not interested</strong> cover {scopeLabel} only. Conversion is qualified ÷
        worked, not ÷ imported — a source with a large untouched backlog is unworked, not
        underperforming.
      </p>

      {data.sources.length === 0 ? (
        <EmptyState>No leads imported yet.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="text-right">Worked</TableHead>
                <TableHead className="text-right">Qualified</TableHead>
                <TableHead className="text-right">Not interested</TableHead>
                <TableHead className="text-right">DNC</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sources.map((s) => (
                <TableRow key={s.source}>
                  <TableCell className="font-medium">{s.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.imported}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.worked}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.qualified}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.notInterested}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.doNotCall}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {s.conversionPct === null ? "—" : `${s.conversionPct}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Updated {new Date(data.generatedAt).toLocaleTimeString()}. Lead figures refresh live on
        assignment events.
      </p>
    </>
  );
}
