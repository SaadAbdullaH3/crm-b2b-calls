"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * LM-01 — upload a lead file and see previous imports.
 *
 * Upload parses the workbook server-side and returns the detected columns, so
 * the next step (mapping) is immediate rather than a second round trip.
 */

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
  createdAt: string;
  uploadedBy: { id: string; fullName: string };
}

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  MAPPING: "secondary",
  VALIDATING: "secondary",
  PENDING_REVIEW: "default",
  COMPLETED: "outline",
  FAILED: "destructive",
};

export function ImportsClient() {
  const router = useRouter();
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ imports: ImportRecord[] }>("/api/leads/imports");
      setImports(data.imports);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load imports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an .xlsx file first.");
      return;
    }

    setUploading(true);
    setError(null);

    const body = new FormData();
    body.append("file", file);
    if (sourceLabel.trim()) body.append("sourceLabel", sourceLabel.trim());

    try {
      const data = await api<{ import: ImportRecord; truncated: number }>(
        "/api/leads/imports",
        { method: "POST", body },
      );
      if (data.truncated > 0) {
        toast.warning(
          `${data.truncated.toLocaleString()} rows beyond the import limit were not read.`,
        );
      }
      toast.success(`Parsed ${data.import.totalRows.toLocaleString()} rows. Map the columns next.`);
      router.push(`/management/imports/${data.import.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Lead Imports"
        requirement="LM-01"
        description="Upload an Excel file of leads, map its columns to CRM fields, then review what will be imported."
      />

      <form
        onSubmit={onUpload}
        className="mb-8 space-y-4 rounded-lg border bg-background p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="file">Excel file (.xlsx)</Label>
            <Input id="file" ref={fileRef} type="file" accept=".xlsx" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source">Lead source / campaign (optional)</Label>
            <Input
              id="source"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. Q4 Trade Show"
            />
          </div>
        </div>

        <ErrorNote message={error} />

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={uploading}>
            {uploading ? "Parsing..." : "Upload and map columns"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Nothing is imported until you review the results.
          </p>
        </div>
      </form>

      <h2 className="mb-3 text-sm font-semibold">Previous imports</h2>

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : imports.length === 0 ? (
        <EmptyState>No imports yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Ready</TableHead>
                <TableHead className="text-right">Flagged</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => {
                const flagged =
                  imp.duplicateRows + imp.missingInfoRows + imp.invalidPhoneRows;
                return (
                  <TableRow key={imp.id}>
                    <TableCell>
                      <Link
                        href={`/management/imports/${imp.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {imp.fileName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {new Date(imp.createdAt).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {imp.sourceLabel ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{imp.uploadedBy.fullName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {imp.totalRows.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {imp.validRows.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {flagged > 0 ? flagged.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[imp.status] ?? "secondary"}>
                        {imp.status.replace(/_/g, " ").toLowerCase()}
                      </Badge>
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
