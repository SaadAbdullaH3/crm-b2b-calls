"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

/**
 * RP-04 — historical reports.
 *
 * Generation date, period and the approving user, which is exactly what the
 * requirement names. The file itself is behind `reports.export`; someone who
 * may see that a report exists is not automatically someone who may open the
 * contact data inside it, so the download button simply is not rendered for
 * them — and the route refuses independently.
 */

interface HistoryRow {
  id: string;
  reportType: string;
  title: string;
  scope: string | null;
  rangeLabel: string | null;
  periodStart: string;
  periodEnd: string;
  format: "XLSX" | "PDF";
  rowCount: number | null;
  fileSize: number | null;
  filters: { agentId?: string | null; source?: string | null; disposition?: string | null } | null;
  generatedAt: string;
  generatedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  downloadable: boolean;
}

const TYPES = [
  { value: "", label: "All reports" },
  { value: "performance", label: "Performance" },
  { value: "sources", label: "Lead sources" },
  { value: "punctuality", label: "Punctuality" },
  { value: "raw", label: "Raw call data" },
];

function size(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function filterSummary(row: HistoryRow): string {
  const f = row.filters ?? {};
  const parts: string[] = [];
  if (f.source) parts.push(`source: ${f.source}`);
  if (f.disposition) parts.push(`outcome: ${f.disposition.replace(/_/g, " ")}`);
  if (f.agentId) parts.push("one agent");
  return parts.length > 0 ? parts.join(", ") : "no filters";
}

export function ReportHistoryClient({
  canDownload,
  canApprove,
}: {
  canDownload: boolean;
  canApprove: boolean;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ reports: HistoryRow[] }>(
        `/api/reports/history${type ? `?type=${type}` : ""}`,
      );
      setRows(data.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report history.");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (row: HistoryRow) => {
    setBusy(row.id);
    try {
      await api(`/api/reports/history/${row.id}`, {
        method: "PATCH",
        json: { approve: true },
      });
      toast.success("Report approved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve the report.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Report history"
        requirement="RP-04"
        description="Every report that was generated, with its period, its filters, who produced it and who signed it off."
        action={
          <Link href="/management/reports">
            <Button variant="outline" size="sm">
              Back to reports
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Report</span>
          <NativeSelect className="w-48" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>
          No reports generated yet. Export one from the Reports screen and it will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Report
                </th>
                <th className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Period
                </th>
                <th className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Generated
                </th>
                <th className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Approved
                </th>
                <th className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  File
                </th>
                <th className="border-b px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b px-3 py-2 text-sm">
                    <div className="font-medium">{row.title}</div>
                    <div className="text-xs text-muted-foreground">{filterSummary(row)}</div>
                  </td>
                  <td className="border-b px-3 py-2 text-sm">
                    {row.rangeLabel ?? `${row.periodStart.slice(0, 10)} → ${row.periodEnd.slice(0, 10)}`}
                  </td>
                  <td className="border-b px-3 py-2 text-sm">
                    <div>{when(row.generatedAt)}</div>
                    <div className="text-xs text-muted-foreground">by {row.generatedBy}</div>
                  </td>
                  <td className="border-b px-3 py-2 text-sm">
                    {row.approvedBy ? (
                      <>
                        <div>{row.approvedBy}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.approvedAt ? when(row.approvedAt) : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not approved</span>
                    )}
                  </td>
                  <td className="border-b px-3 py-2 text-sm">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {row.format}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {size(row.fileSize)}
                      {row.rowCount === null ? "" : ` · ${row.rowCount} rows`}
                    </span>
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {canApprove && !row.approvedBy ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.id}
                          onClick={() => void approve(row)}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {canDownload && row.downloadable ? (
                        <a href={`/api/reports/history/${row.id}`}>
                          <Button size="sm" variant="outline">
                            Download
                          </Button>
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
