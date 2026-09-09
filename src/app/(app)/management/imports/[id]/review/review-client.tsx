"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  PageHeader,
  NativeSelect,
  EmptyState,
  ErrorNote,
  api,
} from "@/components/admin/admin-ui";

/**
 * LM-03 / LM-06 / LM-07 / LM-08 — the pre-import review.
 *
 * Nothing has touched `leads` at this point. This screen is where Management
 * sees exactly what will happen, decides what to do with each duplicate, and
 * only then commits.
 */

const RESOLUTIONS = [
  { value: "PENDING", label: "— Decide —" },
  { value: "REJECT", label: "Reject (don't import)" },
  { value: "KEEP_BOTH", label: "Keep both" },
  { value: "UPDATE_EXISTING", label: "Update existing lead" },
  { value: "MANUAL_REVIEW", label: "Flag for manual review" },
];

const ISSUE_TEXT: Record<string, string> = {
  MISSING_PHONE: "No phone number",
  PHONE_COLUMN_NOT_MAPPED: "No phone column mapped",
  INVALID_PHONE_FORMAT: "Invalid U.S. phone format",
  MISSING_IDENTITY: "No company or contact name",
  INVALID_EMAIL_FORMAT: "Invalid email format",
  DUPLICATE_OF_EXISTING_LEAD: "Already in the CRM",
  DUPLICATE_IN_FILE: "Duplicates an earlier row",
};

function explain(code: string): string {
  if (code.startsWith("MISSING_REQUIRED_FIELD:")) {
    return `Missing required field: ${code.split(":")[1]}`;
  }
  return ISSUE_TEXT[code] ?? code;
}

interface ImportRecord {
  id: string;
  fileName: string;
  sourceLabel: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  missingInfoRows: number;
  invalidPhoneRows: number;
  importedRows: number;
}

interface ImportRow {
  id: string;
  rowNumber: number;
  data: Record<string, unknown>;
  status: string;
  issues: string[] | null;
  resolution: string;
  duplicateOfRowNumber: number | null;
  duplicateMatchedOn: string[] | null;
  duplicateOfLead: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    phoneE164: string | null;
    assignedToId: string | null;
  } | null;
}

export function ReviewClient({ importId }: { importId: string }) {
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [committed, setCommitted] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, rowData] = await Promise.all([
        api<{ import: ImportRecord }>(`/api/leads/imports/${importId}`),
        api<{ rows: ImportRow[]; total: number }>(
          `/api/leads/imports/${importId}/rows?limit=200`,
        ),
      ]);
      setRecord(detail.import);
      setSourceLabel((prev) => prev || detail.import.sourceLabel || "");
      setRows(rowData.rows);
      setTotal(rowData.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this import.");
    } finally {
      setLoading(false);
    }
  }, [importId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>Loading...</EmptyState>;
  if (!record) return <ErrorNote message={error ?? "Import not found."} />;

  const duplicates = rows.filter((r) => r.status === "DUPLICATE");
  const pendingDuplicates = duplicates.filter((r) => r.resolution === "PENDING").length;
  const isCommitted = record.status === "COMPLETED";

  async function setResolution(rowNumber: number, resolution: string) {
    setRows((rs) =>
      rs.map((r) => (r.rowNumber === rowNumber ? { ...r, resolution } : r)),
    );
    try {
      await api(`/api/leads/imports/${importId}/resolutions`, {
        method: "POST",
        json: { resolutions: [{ rowNumber, resolution }] },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that decision.");
      await load();
    }
  }

  async function applyToAll(resolution: string) {
    setBusy(true);
    try {
      const res = await api<{ updated: number }>(
        `/api/leads/imports/${importId}/resolutions`,
        { method: "POST", json: { applyToAllPending: resolution } },
      );
      toast.success(`Applied to ${res.updated} row${res.updated === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ result: { created: number; updated: number; skipped: number } }>(
        `/api/leads/imports/${importId}/commit`,
        { method: "POST", json: { sourceLabel: sourceLabel.trim() || undefined } },
      );
      setCommitted(res.result);
      toast.success(
        `Imported ${res.result.created} new lead${res.result.created === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Review before importing"
        requirement="LM-03"
        description={`${record.fileName} — nothing has been added to the CRM yet.`}
        action={
          <Link
            href="/management/imports"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to imports
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        <Stat label="Total rows" value={record.totalRows} />
        <Stat label="Ready" value={record.validRows} />
        <Stat label="Duplicates" value={record.duplicateRows} />
        <Stat label="Missing info" value={record.missingInfoRows} />
        <Stat label="Invalid phone" value={record.invalidPhoneRows} />
      </div>

      {isCommitted ? (
        <div className="mb-6 rounded-lg border bg-background p-4">
          <p className="text-sm font-medium">This import has been committed.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {record.importedRows.toLocaleString()} lead
            {record.importedRows === 1 ? "" : "s"} added or updated
            {record.sourceLabel ? ` under “${record.sourceLabel}”` : ""}.
          </p>
        </div>
      ) : (
        <div className="mb-6 space-y-4 rounded-lg border bg-background p-5">
          <div className="space-y-2">
            <Label htmlFor="source">Lead source / campaign</Label>
            <Input
              id="source"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. Q4 Trade Show"
              className="max-w-sm"
            />
            <p className="text-xs text-muted-foreground">
              Required (LM-08). Every imported lead is tagged with this, so reports
              can attribute results back to the campaign.
            </p>
          </div>

          {pendingDuplicates > 0 ? (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <p>
                <strong>{pendingDuplicates}</strong> duplicate
                {pendingDuplicates === 1 ? "" : "s"} still need a decision.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["REJECT", "KEEP_BOTH", "UPDATE_EXISTING", "MANUAL_REVIEW"].map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => applyToAll(r)}
                  >
                    {RESOLUTIONS.find((x) => x.value === r)?.label} — all
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <ErrorNote message={error} />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={commit}
              disabled={busy || pendingDuplicates > 0 || !sourceLabel.trim()}
            >
              {busy ? "Importing..." : `Import ${record.validRows.toLocaleString()} ready rows`}
            </Button>
            <a
              href={`/api/leads/imports/${importId}/report`}
              className="text-sm underline-offset-4 hover:underline"
            >
              Download validation report (.xlsx)
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Rows with missing information or an invalid phone format are not imported
            — they stay in the report so the source file can be fixed and re-uploaded.
          </p>
        </div>
      )}

      {committed ? (
        <div className="mb-6 rounded-lg border bg-background p-4 text-sm">
          Created <strong>{committed.created}</strong>, updated{" "}
          <strong>{committed.updated}</strong>, skipped{" "}
          <strong>{committed.skipped}</strong>.
        </div>
      ) : null}

      <h2 className="mb-3 text-sm font-semibold">
        Rows needing attention{" "}
        <span className="font-normal text-muted-foreground">
          ({total.toLocaleString()}
          {rows.length < total ? `, showing first ${rows.length}` : ""})
        </span>
      </h2>

      {rows.length === 0 ? (
        <EmptyState>Every row passed validation.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Row</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead className="w-56">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const d = row.data;
                const isDuplicate = row.status === "DUPLICATE";
                return (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {String(d.companyName ?? d.contactName ?? "—")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[d.contactName, d.phone, d.email]
                          .filter(Boolean)
                          .map(String)
                          .join(" · ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(row.issues ?? []).map((code) => (
                          <Badge key={code} variant="secondary">
                            {explain(code)}
                          </Badge>
                        ))}
                      </div>
                      {row.duplicateOfLead ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Matches: {row.duplicateOfLead.companyName ?? "—"} /{" "}
                          {row.duplicateOfLead.contactName ?? "—"}
                          {row.duplicateOfLead.assignedToId ? " (currently assigned)" : ""}
                        </div>
                      ) : row.duplicateOfRowNumber ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Matches row {row.duplicateOfRowNumber}
                          {row.duplicateMatchedOn?.length
                            ? ` on ${row.duplicateMatchedOn.join(", ")}`
                            : ""}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {isDuplicate && !isCommitted ? (
                        <NativeSelect
                          aria-label={`Decision for row ${row.rowNumber}`}
                          value={row.resolution}
                          onChange={(e) => setResolution(row.rowNumber, e.target.value)}
                        >
                          {RESOLUTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {isDuplicate
                            ? RESOLUTIONS.find((r) => r.value === row.resolution)?.label
                            : "Not imported"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
