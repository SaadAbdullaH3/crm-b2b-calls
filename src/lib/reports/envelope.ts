import type { ReportFilters } from "@/server/reports/definitions";

/**
 * The shared response envelope from Dev A's reporting contract
 * (docs/day7-reporting-api-contract.md §3), typed once for the client.
 *
 * WHY THIS FILE EXISTS: on Day 6 the dashboard client hand-declared its own
 * copy of the server's payload shape, so changing the server response did NOT
 * fail typecheck — the screen would have broken silently at runtime. Here the
 * `data` type is imported from the module that produces it, so a change on
 * Dev A's side is a compile error on mine. The envelope itself is the only
 * thing declared by hand, and it is four fields agreed in writing.
 *
 * `import type` is erased at compile time, so importing from `@/server/...`
 * pulls no server code into the browser bundle.
 */
export interface ReportEnvelope<T> {
  range: { scope: string; from: string; to: string; label: string };
  filters: ReportFilters;
  generatedAt: string;
  data: T;
}

/** The filter state the screen keeps, and posts to every endpoint unchanged. */
export interface ReportQuery {
  scope: string;
  from: string;
  to: string;
  agentId: string;
  source: string;
  disposition: string;
}

export const EMPTY_QUERY: ReportQuery = {
  scope: "week",
  from: "",
  to: "",
  agentId: "",
  source: "",
  disposition: "",
};

/**
 * One query string for every endpoint. Dev A's parser ignores filters an
 * endpoint does not use, which is what lets the screen hold a single filter
 * state and send it everywhere without branching per report.
 */
export function toQueryString(q: ReportQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ scope: q.scope });
  if (q.scope === "custom") {
    if (q.from) params.set("from", q.from);
    if (q.to) params.set("to", q.to);
  }
  if (q.agentId) params.set("agentId", q.agentId);
  if (q.source) params.set("source", q.source);
  if (q.disposition) params.set("disposition", q.disposition);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params.toString();
}

export const SCOPE_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  "last-week": "Last week",
  month: "This month",
  "last-month": "Last month",
  "15d": "Last 15 days",
  custom: "Custom range",
};
