"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
 * LM-02 — map each detected spreadsheet column onto a CRM field.
 *
 * Targets come from the server: the fixed `leads` columns plus every active
 * Admin-defined dynamic field (AD-05), whose values land in
 * `leads.custom_fields` under the field's `key`.
 *
 * Saving runs validation and duplicate detection over the whole file. The
 * results screen that reads those verdicts is Day 3; today this reports the
 * counts so the analysis is visible end to end.
 */

interface MappingTarget {
  key: string;
  label: string;
  kind: "FIXED" | "CUSTOM";
  required: boolean;
  helpText?: string;
}

interface ImportDetail {
  import: {
    id: string;
    fileName: string;
    sourceLabel: string | null;
    status: string;
    totalRows: number;
    validRows: number;
    duplicateRows: number;
    missingInfoRows: number;
    invalidPhoneRows: number;
  };
  headers: string[];
  targets: MappingTarget[];
  mapping: Record<string, string>;
  ignoreValue: string;
}

interface AnalysisSummary {
  totalRows: number;
  readyRows: number;
  duplicateRows: number;
  missingInfoRows: number;
  invalidPhoneRows: number;
}

export function MapperClient({ importId }: { importId: string }) {
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<ImportDetail>(`/api/leads/imports/${importId}`);
      setDetail(data);
      setMapping(data.mapping);
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
  if (!detail) return <ErrorNote message={error ?? "Import not found."} />;

  const ignore = detail.ignoreValue;

  // A CRM field can only receive one column; show the clash inline rather than
  // waiting for the server to reject the whole save.
  const assigned = Object.values(mapping).filter((k) => k !== ignore);
  const duplicates = new Set(assigned.filter((k, i) => assigned.indexOf(k) !== i));
  const phoneMapped = assigned.includes("phone");

  const unmappedRequired = detail.targets.filter(
    (t) => t.required && !assigned.includes(t.key),
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ summary: AnalysisSummary }>(
        `/api/leads/imports/${importId}/mapping`,
        { method: "POST", json: { mapping } },
      );
      setSummary(data.summary);
      toast.success("Columns mapped and file analysed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Map columns"
        requirement="LM-02"
        description={`${detail.import.fileName} — ${detail.import.totalRows.toLocaleString()} rows detected. Choose which CRM field each column becomes, or ignore it.`}
        action={
          <Link
            href="/management/imports"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to imports
          </Link>
        }
      />

      {!phoneMapped ? (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
          No column is mapped to <strong>Phone Number</strong>. Every row will be
          flagged as missing information — a lead with no number cannot be called.
        </p>
      ) : null}

      {unmappedRequired.length > 0 ? (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
          Required {unmappedRequired.length === 1 ? "field" : "fields"} not mapped:{" "}
          <strong>{unmappedRequired.map((t) => t.label).join(", ")}</strong>. No imported
          lead will carry {unmappedRequired.length === 1 ? "this value" : "these values"}.
          Map a column, or continue if the file genuinely doesn&apos;t have it.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2">Column in file</TableHead>
              <TableHead>Maps to CRM field</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.headers.map((header, index) => {
              const key = String(index);
              const value = mapping[key] ?? ignore;
              const clash = value !== ignore && duplicates.has(value);
              return (
                <TableRow key={key}>
                  <TableCell>
                    <span className="font-medium">{header}</span>
                    <div className="text-xs text-muted-foreground">
                      Column {index + 1}
                    </div>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Map column ${header}`}
                      value={value}
                      className={clash ? "border-destructive" : undefined}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [key]: e.target.value }))
                      }
                    >
                      <option value={ignore}>— Ignore this column —</option>
                      <optgroup label="Lead fields">
                        {detail.targets
                          .filter((t) => t.kind === "FIXED")
                          .map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                              {t.required ? " *" : ""}
                            </option>
                          ))}
                      </optgroup>
                      {detail.targets.some((t) => t.kind === "CUSTOM") ? (
                        <optgroup label="Custom fields (Admin-defined)">
                          {detail.targets
                            .filter((t) => t.kind === "CUSTOM")
                            .map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.label}
                                {t.required ? " *" : ""}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                    </NativeSelect>
                    {clash ? (
                      <p className="mt-1 text-xs text-destructive">
                        Mapped more than once.
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 space-y-3">
        <ErrorNote message={error} />
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || duplicates.size > 0}>
            {saving ? "Analysing..." : "Save mapping and analyse file"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Checks for duplicates, missing information and U.S. phone format. Still
            imports nothing.
          </p>
        </div>
      </div>

      {summary ? (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Analysis</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Ready to import" value={summary.readyRows} tone="default" />
            <Stat label="Duplicates" value={summary.duplicateRows} tone="secondary" />
            <Stat label="Missing info" value={summary.missingInfoRows} tone="secondary" />
            <Stat
              label="Invalid phone format"
              value={summary.invalidPhoneRows}
              tone="secondary"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Every row was kept, including the flagged ones.
          </p>
          <Link
            href={`/management/imports/${importId}/review`}
            className="mt-4 inline-block text-sm font-medium underline-offset-4 hover:underline"
          >
            Review and import &rarr;
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "secondary";
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <Badge variant={tone} className="mt-2">
        {label}
      </Badge>
    </div>
  );
}
