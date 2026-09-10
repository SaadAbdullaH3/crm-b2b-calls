"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
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
 * MG-05 / MG-10 — one agent: results, leads, calls, callbacks, attendance and
 * a chronological activity feed.
 *
 * The monitoring tab renders only when the API says the viewer holds
 * `monitoring.view` (TM-05), and recording references only with
 * `calls.recording.access` (CL-05). Both flags come from the server rather
 * than being re-derived here.
 */

type Tab = "calls" | "leads" | "callbacks" | "activity" | "attendance";

interface Detail {
  agent: {
    id: string;
    fullName: string;
    email: string;
    employeeCode: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
    hrEmployee: {
      department: string | null;
      designation: string | null;
      shift: string | null;
      joinedAt: string | null;
    } | null;
  };
  canSeeMonitoring: boolean;
  canSeeRecordings: boolean;
  stats: {
    leadsHeld: number;
    calls: number;
    totalTalkSec: number;
    avgTalkSec: number;
    noAnswer: number;
    callBackLater: number;
    notInterested: number;
    doNotCall: number;
    qualified: number;
    pendingCallbacks: number;
    overdueCallbacks: number;
    monitoring?: {
      state: string | null;
      activeMs: number;
      idleMs: number;
      breakMs: number;
      productivityPct: number | null;
    };
  } | null;
  calls: {
    id: string;
    durationSec: number | null;
    startedAt: string | null;
    channel: string;
    notes: string | null;
    recordingRef?: string | null;
    disposition: { code: string; label: string } | null;
    lead: { id: string; companyName: string | null; contactName: string | null };
  }[];
  leads: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    status: string;
    lastDispositionCode: string | null;
    nextCallbackAt: string | null;
    callAttempts: number;
    doNotCall: boolean;
    sourceLabel: string | null;
  }[];
  callbacks: {
    id: string;
    scheduledFor: string;
    lead: { companyName: string | null; contactName: string | null };
  }[];
  activity: { id: string; type: string; occurredAt: string }[];
  attendance: {
    date: string;
    startedAt: string;
    endedAt: string | null;
    stillIn: boolean;
    idleCount: number;
    breakCount: number;
  }[];
  requests: {
    id: string;
    quantityRequested: number;
    quantityApproved: number | null;
    status: string;
    createdAt: string;
    reviewedBy: { fullName: string } | null;
  }[];
  now: string;
}

function hm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
}

const ACTIVITY_LABEL: Record<string, string> = {
  "session.login": "Signed in",
  "session.logout": "Signed out",
  "session.expired": "Session expired",
  "monitoring.idle.start": "Went idle",
  "monitoring.idle.end": "Resumed",
  "monitoring.break.start": "Started a break",
  "monitoring.break.end": "Ended a break",
};

export function AgentDetailClient({ agentId }: { agentId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [scope, setScope] = useState("7d");
  const [tab, setTab] = useState<Tab>("calls");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/management/agents/${agentId}?scope=${scope}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <ErrorNote message={error} />;

  const { agent, stats } = data;
  const now = new Date(data.now).getTime();

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "calls", label: "Calls", count: data.calls.length },
    { key: "leads", label: "Leads held", count: data.leads.length },
    { key: "callbacks", label: "Callbacks", count: data.callbacks.length },
    { key: "attendance", label: "Attendance", count: data.attendance.length },
    { key: "activity", label: "Activity", count: data.activity.length },
  ];

  return (
    <>
      <PageHeader
        title={agent.fullName}
        requirement="MG-05"
        description={
          [
            agent.hrEmployee?.designation,
            agent.hrEmployee?.department,
            agent.hrEmployee?.shift,
            agent.employeeCode,
          ]
            .filter(Boolean)
            .join(" · ") || agent.email
        }
        action={
          <div className="flex items-center gap-2">
            <Link href="/management" className="text-sm underline">
              Back
            </Link>
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

      {stats ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Leads held", value: String(stats.leadsHeld) },
            { label: "Calls", value: String(stats.calls) },
            { label: "Talk time", value: hm(stats.totalTalkSec) },
            { label: "Avg call", value: hm(stats.avgTalkSec) },
            { label: "Qualified", value: String(stats.qualified) },
            {
              label: "Callbacks due",
              value: String(stats.pendingCallbacks),
              warn: stats.overdueCallbacks > 0 ? `${stats.overdueCallbacks} overdue` : null,
            },
          ].map((t) => (
            <Card key={t.label}>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
                {"warn" in t && t.warn ? (
                  <p className="text-[10px] text-destructive">{t.warn}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* TM-05: this block exists only for a holder of monitoring.view. */}
      {data.canSeeMonitoring && stats?.monitoring ? (
        <div className="mb-6 rounded-lg border bg-background p-4">
          <h2 className="mb-2 text-sm font-semibold">Activity metrics</h2>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-lg font-semibold">{hm(stats.monitoring.activeMs / 1000)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Idle</p>
              <p className="text-lg font-semibold">{hm(stats.monitoring.idleMs / 1000)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Break</p>
              <p className="text-lg font-semibold">{hm(stats.monitoring.breakMs / 1000)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Productivity</p>
              <p className="text-lg font-semibold">
                {stats.monitoring.productivityPct === null
                  ? "—"
                  : `${stats.monitoring.productivityPct}%`}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm ${
              tab === t.key ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === "calls" ? (
        data.calls.length === 0 ? (
          <EmptyState>No calls in this period.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Notes</TableHead>
                  {data.canSeeRecordings ? <TableHead>Recording</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.calls.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.lead.companyName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.lead.contactName}</div>
                    </TableCell>
                    <TableCell>
                      {c.disposition ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {c.disposition.label}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.durationSec ? hm(c.durationSec) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.startedAt ? new Date(c.startedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="max-w-56 text-xs text-muted-foreground">
                      <div className="line-clamp-2">{c.notes ?? "—"}</div>
                    </TableCell>
                    {data.canSeeRecordings ? (
                      <TableCell className="text-xs">
                        {c.recordingRef ? (
                          <span className="font-mono">{c.recordingRef}</span>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.canSeeRecordings ? (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                CL-05 — recording references appear once VC Dialer integration is confirmed.
                See the VC Dialer status line in GLOBAL.md.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {tab === "leads" ? (
        data.leads.length === 0 ? (
          <EmptyState>No leads currently held.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last outcome</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.companyName ?? "—"}
                      {l.doNotCall ? (
                        <Badge className="ml-2 bg-destructive text-[10px] text-white">DNC</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{l.contactName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{l.status.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">
                      {l.lastDispositionCode?.replace(/_/g, " ") ?? "not called"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.callAttempts}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.sourceLabel ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      {tab === "callbacks" ? (
        data.callbacks.length === 0 ? (
          <EmptyState>No scheduled callbacks.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Scheduled for</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.callbacks.map((c) => {
                  const overdue = new Date(c.scheduledFor).getTime() < now;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.lead.companyName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{c.lead.contactName}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(c.scheduledFor).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {overdue ? (
                          <Badge className="bg-destructive text-white">overdue</Badge>
                        ) : (
                          <Badge variant="secondary">scheduled</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      {tab === "attendance" ? (
        data.attendance.length === 0 ? (
          <EmptyState>No sign-ins in this period.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Signed out</TableHead>
                  {data.canSeeMonitoring ? (
                    <TableHead className="text-right">Idle / break</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.attendance.map((a, i) => (
                  <TableRow key={`${a.date}-${i}`}>
                    <TableCell className="text-sm">
                      {new Date(a.date).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {new Date(a.startedAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {a.stillIn ? (
                        <Badge className="bg-emerald-600 text-white">still in</Badge>
                      ) : a.endedAt ? (
                        new Date(a.endedAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {data.canSeeMonitoring ? (
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {a.idleCount}× idle, {a.breakCount}× break
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      {tab === "activity" ? (
        data.activity.length === 0 ? (
          <EmptyState>No activity recorded in this period.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-background">
            {data.activity.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b px-4 py-2 last:border-0">
                <span className="text-sm">{ACTIVITY_LABEL[e.type] ?? e.type}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )
      ) : null}

      {data.requests.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Lead request history</h2>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed by</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-right tabular-nums">
                      {r.quantityRequested}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.quantityApproved ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.status.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.reviewedBy?.fullName ?? "system"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </>
  );
}
