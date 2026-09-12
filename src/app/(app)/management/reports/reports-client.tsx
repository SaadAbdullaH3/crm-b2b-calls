"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import type { PerformanceReport } from "@/server/reports/performance";
import type { SourceReport } from "@/server/reports/sources";
import type { PunctualityReport } from "@/server/reports/punctuality";
import type { RawReport } from "@/server/reports/raw";
import {
  EMPTY_QUERY,
  SCOPE_LABELS,
  toQueryString,
  type ReportEnvelope,
  type ReportQuery,
} from "@/lib/reports/envelope";

/**
 * RP-01 / RP-02 — the report screen.
 *
 * ONE screen with a scope selector, not five screens. Daily, Weekly, Monthly,
 * 15-day and Custom are the same aggregation over different windows, and Dev A
 * serves them from one endpoint; building five screens would have been five
 * places to fix the same bug.
 *
 * Every payload type here is IMPORTED from the module that produces it, so if
 * the server shape changes this file stops compiling. On Day 6 the dashboard
 * hand-declared its own copy and a shape change would have broken the screen
 * silently at runtime.
 */

type Tab = "performance" | "sources" | "punctuality" | "raw";

const TABS: { key: Tab; label: string; requirement: string }[] = [
  { key: "performance", label: "Performance", requirement: "RP-01" },
  { key: "sources", label: "Lead sources", requirement: "RP-01" },
  { key: "punctuality", label: "Punctuality", requirement: "MG-07" },
  { key: "raw", label: "Raw data", requirement: "RP-02" },
];

interface Meta {
  scopes: string[];
  agents: { id: string; fullName: string; isActive: boolean }[];
  sources: string[];
  dispositions: string[];
}

const RAW_PAGE_SIZE = 50;

function hms(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b px-3 py-2 text-xs font-medium text-muted-foreground ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`border-b px-3 py-2 text-sm ${right ? "text-right tabular-nums" : ""}`}>
      {children}
    </td>
  );
}

export function ReportsClient({ canExport, canScore }: { canExport: boolean; canScore: boolean }) {
  const [tab, setTab] = useState<Tab>("performance");
  const [query, setQuery] = useState<ReportQuery>(EMPTY_QUERY);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [envelope, setEnvelope] = useState<ReportEnvelope<unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [rawOffset, setRawOffset] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        setMeta(await api<Meta>("/api/reports/meta"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the filter options.");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const extra: Record<string, string> =
        tab === "raw" ? { offset: String(rawOffset), limit: String(RAW_PAGE_SIZE) } : {};
      const data = await api<ReportEnvelope<unknown>>(
        `/api/reports/${tab}?${toQueryString(query, extra)}`,
      );
      setEnvelope(data);
    } catch (e) {
      setEnvelope(null);
      setError(e instanceof Error ? e.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [tab, query, rawOffset]);

  useEffect(() => {
    void load();
  }, [load]);

  // A filter change must reset paging, or page 4 of the old filter silently
  // becomes page 4 of a shorter new result and the screen looks empty.
  const setFilter = (patch: Partial<ReportQuery>) => {
    setRawOffset(0);
    setQuery((q) => ({ ...q, ...patch }));
  };

  const runExport = async (format: "XLSX" | "PDF") => {
    setExporting(format);
    try {
      const result = await api<{ id: string; fileName: string; sizeBytes: number }>(
        `/api/reports/export?${toQueryString(query, { kind: tab, format })}`,
        { method: "POST" },
      );
      // Download through the history route, so the bytes downloaded now come
      // off the same path as the bytes downloaded from the archive in March.
      // A temporary anchor rather than `window.location.href`: the response is
      // an attachment, so this starts the download without navigating the app
      // away from the report the user is still reading.
      const link = document.createElement("a");
      link.href = `/api/reports/history/${result.id}`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`${result.fileName} generated`, {
        description: "Saved to report history.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const scopes = meta?.scopes ?? ["today", "week", "month"];

  return (
    <div>
      <PageHeader
        title="Reports"
        requirement="RP-01 … RP-04"
        description="Daily, weekly, monthly, 15-day and custom periods are one aggregation over different windows. Report periods are calendar periods — this month means the 1st to today, not the last 30 days."
        action={
          <div className="flex gap-2">
            {canScore ? (
              <Link href="/management/scores">
                <Button variant="outline" size="sm">
                  Management Scores
                </Button>
              </Link>
            ) : null}
            <Link href="/management/reports/history">
              <Button variant="outline" size="sm">
                Report history
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Period</span>
          <NativeSelect
            className="w-44"
            value={query.scope}
            onChange={(e) => setFilter({ scope: e.target.value })}
          >
            {scopes.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s] ?? s}
              </option>
            ))}
          </NativeSelect>
        </label>

        {query.scope === "custom" ? (
          <>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">From</span>
              <input
                type="date"
                className="h-9 rounded-md border px-3 text-sm"
                value={query.from}
                onChange={(e) => setFilter({ from: e.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">To</span>
              <input
                type="date"
                className="h-9 rounded-md border px-3 text-sm"
                value={query.to}
                onChange={(e) => setFilter({ to: e.target.value })}
              />
            </label>
          </>
        ) : null}

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Agent</span>
          <NativeSelect
            className="w-48"
            value={query.agentId}
            onChange={(e) => setFilter({ agentId: e.target.value })}
          >
            <option value="">All agents</option>
            {(meta?.agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
                {a.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Source</span>
          <NativeSelect
            className="w-48"
            value={query.source}
            onChange={(e) => setFilter({ source: e.target.value })}
          >
            <option value="">All sources</option>
            {(meta?.sources ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Outcome</span>
          <NativeSelect
            className="w-44"
            value={query.disposition}
            onChange={(e) => setFilter({ disposition: e.target.value })}
          >
            <option value="">All outcomes</option>
            {(meta?.dispositions ?? []).map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </label>

        <div className="ml-auto flex items-end gap-2">
          {canExport ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={exporting !== null || loading}
                onClick={() => void runExport("XLSX")}
              >
                {exporting === "XLSX" ? "Generating…" : "Export Excel"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={exporting !== null || loading}
                onClick={() => void runExport("PDF")}
              >
                {exporting === "PDF" ? "Generating…" : "Export PDF"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.filter((t) => t.key !== "raw" || canExport).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setRawOffset(0);
              setTab(t.key);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.key
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
              {t.requirement}
            </span>
          </button>
        ))}
      </div>

      {envelope ? (
        <p className="mb-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{envelope.range.label}</span>
          {" — generated "}
          {dateTime(envelope.generatedAt)}
        </p>
      ) : null}

      <ErrorNote message={error} />

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : !envelope ? null : tab === "performance" ? (
        <PerformanceView report={envelope.data as PerformanceReport} />
      ) : tab === "sources" ? (
        <SourcesView report={envelope.data as SourceReport} />
      ) : tab === "punctuality" ? (
        <PunctualityView report={envelope.data as PunctualityReport} />
      ) : (
        <RawView
          report={envelope.data as RawReport}
          offset={rawOffset}
          onOffset={setRawOffset}
        />
      )}
    </div>
  );
}

/**
 * The trend line, bucketed.
 *
 * `byDay` fills every day in the range, so a custom year returns 365 rows and
 * a per-day bar chart becomes 365 slivers nobody can read. Consecutive days are
 * grouped into at most 45 bars, and each bar says which days it covers — an
 * honest summary rather than a chart that silently drops data.
 */
function bucketDays(byDay: PerformanceReport["byDay"], maxBars = 45) {
  if (byDay.length <= maxBars) {
    return byDay.map((d) => ({
      key: d.date,
      label: d.date.slice(8),
      title: d.date,
      calls: d.calls,
      leadsWorked: d.leadsWorked,
      qualified: d.qualified,
    }));
  }

  const size = Math.ceil(byDay.length / maxBars);
  const buckets: {
    key: string;
    label: string;
    title: string;
    calls: number;
    leadsWorked: number;
    qualified: number;
  }[] = [];

  for (let i = 0; i < byDay.length; i += size) {
    const chunk = byDay.slice(i, i + size);
    const last = chunk[chunk.length - 1];
    buckets.push({
      key: chunk[0].date,
      label: chunk[0].date.slice(5),
      title: `${chunk[0].date} → ${last.date}`,
      calls: chunk.reduce((n, d) => n + d.calls, 0),
      leadsWorked: chunk.reduce((n, d) => n + d.leadsWorked, 0),
      qualified: chunk.reduce((n, d) => n + d.qualified, 0),
    });
  }
  return buckets;
}

function PerformanceView({ report }: { report: PerformanceReport }) {
  const { totals } = report;
  const bars = bucketDays(report.byDay);
  const maxCalls = Math.max(1, ...bars.map((d) => d.calls));
  const bucketed = bars.length < report.byDay.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Leads assigned" value={String(totals.leadsAssigned)} hint="assignments opened" />
        <Tile label="Leads worked" value={String(totals.leadsWorked)} hint="an outcome was recorded" />
        <Tile label="Calls made" value={String(totals.callsMade)} />
        <Tile label="Talk time" value={hms(totals.talkTimeSec)} hint={`avg ${hms(totals.avgTalkSec)}`} />
        <Tile
          label="Qualified"
          value={String(totals.qualified)}
          hint={`${totals.conversionPct.toFixed(1)}% of worked`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Callbacks set" value={String(totals.callbacksSet)} />
        <Tile label="Callbacks completed" value={String(totals.callbacksDone)} />
        <Tile
          label="Outcomes recorded"
          value={String(
            Object.entries(report.outcomes)
              .filter(([code]) => code !== "undispositioned")
              .reduce((sum, [, n]) => sum + n, 0),
          )}
        />
        <Tile
          label="No outcome yet"
          value={String(report.outcomes.undispositioned ?? 0)}
          hint="dialled, nothing recorded"
        />
      </div>

      {report.byDay.length > 1 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium">
            Calls by day
            {bucketed ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                grouped — each bar covers several days
              </span>
            ) : null}
          </h2>
          <div className="flex h-32 items-end gap-1 rounded-lg border p-3">
            {bars.map((d) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-foreground/80"
                  style={{ height: `${(d.calls / maxCalls) * 100}%` }}
                  title={`${d.title}: ${d.calls} calls, ${d.leadsWorked} leads worked, ${d.qualified} qualified`}
                />
                <span className="text-[9px] text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-medium">By agent</h2>
        {report.byAgent.length === 0 ? (
          <EmptyState>No agent activity in this period.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th right>Leads worked</Th>
                  <Th right>Calls</Th>
                  <Th right>Talk time</Th>
                  <Th right>Avg talk</Th>
                  <Th right>Qualified</Th>
                  <Th right>Conversion</Th>
                  <Th right>Callbacks</Th>
                </tr>
              </thead>
              <tbody>
                {report.byAgent.map((a) => (
                  <tr key={a.agentId}>
                    <Td>{a.fullName}</Td>
                    <Td right>{a.leadsWorked}</Td>
                    <Td right>{a.calls}</Td>
                    <Td right>{hms(a.talkTimeSec)}</Td>
                    <Td right>{hms(a.avgTalkSec)}</Td>
                    <Td right>{a.qualified}</Td>
                    <Td right>{a.conversionPct.toFixed(1)}%</Td>
                    <Td right>
                      {a.callbacksDone}/{a.callbacksSet}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Conversion is qualified ÷ leads worked — a lead carrying an outcome, not a dialled
          attempt. Average talk time counts only calls that have a duration.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Outcome mix</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Outcome</Th>
                <Th right>Calls</Th>
                <Th right>Share</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.outcomes).map(([code, count]) => (
                <tr key={code}>
                  <Td>
                    {code === "undispositioned" ? (
                      <span className="text-muted-foreground">No outcome recorded</span>
                    ) : (
                      code.replace(/_/g, " ")
                    )}
                  </Td>
                  <Td right>{count}</Td>
                  <Td right>
                    {totals.callsMade > 0
                      ? `${((count / totals.callsMade) * 100).toFixed(1)}%`
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SourcesView({ report }: { report: SourceReport }) {
  if (report.sources.length === 0) {
    return <EmptyState>No lead sources yet — import some leads first.</EmptyState>;
  }

  return (
    <section>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Source</Th>
              <Th right>Imported</Th>
              <Th right>Owned now</Th>
              <Th right>Worked</Th>
              <Th right>Contacted</Th>
              <Th right>Qualified</Th>
              <Th right>Do Not Call now</Th>
              <Th right>Worked %</Th>
              <Th right>Conversion</Th>
            </tr>
          </thead>
          <tbody>
            {report.sources.map((s) => (
              <tr key={s.source}>
                <Td>{s.source}</Td>
                <Td right>{s.imported}</Td>
                <Td right>{s.assigned}</Td>
                <Td right>{s.worked}</Td>
                <Td right>{s.contacted}</Td>
                <Td right>{s.qualified}</Td>
                <Td right>{s.doNotCall}</Td>
                <Td right>{s.workedPct.toFixed(1)}%</Td>
                <Td right>{s.conversionPct.toFixed(1)}%</Td>
              </tr>
            ))}
            <tr className="font-medium">
              <Td>Total</Td>
              <Td right>{report.totals.imported}</Td>
              <Td right>{report.totals.assigned}</Td>
              <Td right>{report.totals.worked}</Td>
              <Td right>{report.totals.contacted}</Td>
              <Td right>{report.totals.qualified}</Td>
              <Td right>{report.totals.doNotCall}</Td>
              <Td right>{report.totals.workedPct.toFixed(1)}%</Td>
              <Td right>{report.totals.conversionPct.toFixed(1)}%</Td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Imported, worked, contacted and qualified count what happened{" "}
        <span className="font-medium text-foreground">inside the selected period</span>. Owned now
        and Do Not Call now are current state and do not move with the period, so a one-day period
        cannot read as &ldquo;56 leads assigned today&rdquo;. Owned now counts every lead that still
        has an agent attached, closed ones included — the dashboard&apos;s Assigned tile counts only
        leads still being worked, so the two differ by the closed ones. Conversion is qualified ÷
        worked, never ÷ imported: a source with a large untouched backlog is unworked, not
        underperforming. Worked % compares work done in the period against leads imported in that
        same period, so it reads 0% for a period with no imports.
      </p>
    </section>
  );
}

function PunctualityView({ report }: { report: PunctualityReport }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Shift starts at <span className="font-medium text-foreground">{report.shift.startTime}</span>{" "}
        with a {report.shift.graceMinutes}-minute grace period. Late means the first login of the
        day falls after that.
      </p>

      <section>
        <h2 className="mb-2 text-sm font-medium">Summary by agent</h2>
        {report.summary.length === 0 ? (
          <EmptyState>No logins in this period.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th right>Days present</Th>
                  <Th right>Days late</Th>
                  <Th right>Late minutes</Th>
                  <Th right>On time</Th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((s) => (
                  <tr key={s.agentId}>
                    <Td>{s.fullName}</Td>
                    <Td right>{s.daysPresent}</Td>
                    <Td right>{s.daysLate}</Td>
                    <Td right>{s.totalLateMinutes}</Td>
                    <Td right>{s.onTimePct.toFixed(1)}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Day by day</h2>
        {report.rows.length === 0 ? (
          <EmptyState>Nothing to show for this period.</EmptyState>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <Th>Date</Th>
                  <Th>Agent</Th>
                  <Th>First login</Th>
                  <Th right>Late (min)</Th>
                  <Th right>Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.agentId}-${r.date}`}>
                    <Td>{r.date}</Td>
                    <Td>{r.fullName}</Td>
                    <Td>
                      {dateTime(r.firstLoginAt)}
                      {r.onTime ? null : (
                        <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                          late
                        </span>
                      )}
                    </Td>
                    <Td right>{r.lateMinutes}</Td>
                    <Td right>{r.sessionCount}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RawView({
  report,
  offset,
  onOffset,
}: {
  report: RawReport;
  offset: number;
  onOffset: (n: number) => void;
}) {
  const end = Math.min(offset + report.rows.length, report.total);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {report.total === 0
            ? "No calls in this period."
            : `Showing ${offset + 1}–${end} of ${report.total} calls`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => onOffset(Math.max(0, offset - RAW_PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={end >= report.total}
            onClick={() => onOffset(offset + RAW_PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      {report.rows.length === 0 ? (
        <EmptyState>Nothing to show. Widen the period or clear a filter.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Agent</Th>
                <Th>Company</Th>
                <Th>Contact</Th>
                <Th>Phone</Th>
                <Th>Source</Th>
                <Th>Outcome</Th>
                <Th right>Duration</Th>
                <Th>Channel</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.callId}>
                  <Td>{dateTime(r.at)}</Td>
                  <Td>{r.agent}</Td>
                  <Td>{r.company ?? "—"}</Td>
                  <Td>{r.contact ?? "—"}</Td>
                  <Td>{r.phone ?? "—"}</Td>
                  <Td>{r.source ?? "—"}</Td>
                  <Td>
                    {r.outcome ?? <span className="text-muted-foreground">No outcome recorded</span>}
                  </Td>
                  <Td right>{r.durationSec === null ? "—" : hms(r.durationSec)}</Td>
                  <Td>{r.channel}</Td>
                  <Td>
                    <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
                      {r.notes ?? ""}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        RP-02 — the underlying rows, before any score. A blank duration is a MANUAL row: an outcome
        recorded without dialling, which carries no duration by design.
      </p>
    </section>
  );
}
