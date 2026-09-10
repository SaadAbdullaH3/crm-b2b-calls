"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * The Agent Dashboard.
 *
 * !! TM-05 !! Nothing on this screen may show Active Time, Idle Time,
 * Break/Pause Time or Productivity %. The API it reads cannot supply them —
 * `agent-metrics.ts` does not import the monitoring engine — so the boundary
 * holds at the data layer, not just here.
 *
 * What an agent gets instead is operational: what they hold, what they did
 * today, and what they owe.
 */

interface Dashboard {
  today: { callsMade: number; leadsWorked: number; outcomes: Record<string, number> };
  leads: {
    held: number;
    toCall: number;
    inProgress: number;
    closedQualified: number;
    closedNotInterested: number;
    doNotCall: number;
  };
  callbacks: { overdue: number; dueToday: number; upcoming: number; completedToday: number };
  unreadNotifications: number;
}

const OUTCOME_LABEL: Record<string, string> = {
  NO_ANSWER: "No answer",
  CALL_BACK_LATER: "Call back later",
  NOT_INTERESTED: "Not interested",
  DO_NOT_CALL: "Do not call",
  EMAIL: "Email",
  QUALIFIED: "Qualified",
};

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "default" | "destructive";
}) {
  const body = (
    <div className="rounded-lg border bg-background p-4 transition-colors hover:bg-accent/40">
      <div
        className={`text-2xl font-semibold tabular-nums ${tone === "destructive" && value > 0 ? "text-destructive" : ""}`}
      >
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function AgentDashboardClient({ name }: { name: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ dashboard: Dashboard }>("/api/agent/dashboard");
      setData(res.dashboard);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>Loading...</EmptyState>;
  if (!data) return <ErrorNote message={error ?? "No data."} />;

  const totalOutcomes = Object.values(data.today.outcomes).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Good to see you, ${name.split(" ")[0]}`}
        description="Where your leads stand today."
      />

      <ErrorNote message={error} />

      <h2 className="mb-3 text-sm font-semibold">Today</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        <Stat label="Calls made" value={data.today.callsMade} />
        <Stat label="Leads worked" value={data.today.leadsWorked} />
        <Stat
          label="Callbacks completed"
          value={data.callbacks.completedToday}
          href="/agent/callbacks"
        />
        <Stat label="Unread notifications" value={data.unreadNotifications} href="/notifications" />
      </div>

      <h2 className="mb-3 text-sm font-semibold">Your leads</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Held" value={data.leads.held} />
        <Stat label="Still to call" value={data.leads.toCall} href="/agent/call-list" />
        <Stat label="In progress" value={data.leads.inProgress} />
        <Stat label="Qualified" value={data.leads.closedQualified} />
        <Stat label="Not interested" value={data.leads.closedNotInterested} />
        <Stat label="Do not call" value={data.leads.doNotCall} />
      </div>

      <h2 className="mb-3 text-sm font-semibold">Callbacks you owe</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Overdue"
          value={data.callbacks.overdue}
          href="/agent/callbacks"
          tone="destructive"
        />
        <Stat label="Due today" value={data.callbacks.dueToday} href="/agent/callbacks" />
        <Stat label="Upcoming" value={data.callbacks.upcoming} href="/agent/callbacks" />
      </div>

      <h2 className="mb-3 text-sm font-semibold">
        Today&apos;s outcomes{" "}
        <span className="font-normal text-muted-foreground">({totalOutcomes})</span>
      </h2>
      {totalOutcomes === 0 ? (
        <EmptyState>No outcomes recorded yet today.</EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.today.outcomes)
            .filter(([, n]) => n > 0)
            .map(([code, n]) => (
              <Badge key={code} variant="secondary" className="px-3 py-1 text-sm">
                {OUTCOME_LABEL[code] ?? code}: <strong className="ml-1">{n}</strong>
              </Badge>
            ))}
        </div>
      )}
    </div>
  );
}
