"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, NativeSelect, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/** HR-01/02/06 — profiles, documents, employment history. */

const DOC_TYPES = [
  "UNDERTAKING",
  "AGREEMENT",
  "CONTRACT",
  "WARNING_LETTER",
  "PERFORMANCE_REVIEW",
  "ID_PROOF",
  "CERTIFICATE",
  "OTHER",
] as const;

const EVENT_TYPES = [
  "NOTE",
  "WARNING",
  "PERFORMANCE_REVIEW",
  "PROMOTION",
  "ROLE_CHANGE",
  "COMMENDATION",
  "PROBATION",
  "CONFIRMED",
  "EXIT",
] as const;

interface EmployeeRow {
  id: string;
  department: string | null;
  designation: string | null;
  shift: string | null;
  joinedAt: string | null;
  exitedAt: string | null;
  user: {
    id: string;
    fullName: string;
    email: string;
    employeeCode: string | null;
    phone: string | null;
    isActive: boolean;
    role: { name: string; label: string };
  };
  _count: { documents: number; events: number };
}

interface UnprofiledUser {
  id: string;
  fullName: string;
  email: string;
  role: { label: string };
}

interface HrEvent {
  id: string;
  type: string;
  title: string;
  details: string | null;
  effectiveDate: string;
  recordedBy: { fullName: string };
}

interface HrDoc {
  id: string;
  docType: string;
  fileName: string;
  sizeBytes: number | null;
  expiresAt: string | null;
  notes: string | null;
  uploadedAt: string;
  uploadedBy: { fullName: string };
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function kb(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function EmployeesClient({
  canManage,
  canSeeDocuments,
}: {
  canManage: boolean;
  canSeeDocuments: boolean;
}) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [unprofiled, setUnprofiled] = useState<UnprofiledUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [form, setForm] = useState({ department: "", designation: "", shift: "", joinedAt: "" });

  const [detail, setDetail] = useState<EmployeeRow | null>(null);
  const [events, setEvents] = useState<HrEvent[]>([]);
  const [docs, setDocs] = useState<HrDoc[]>([]);
  const [tab, setTab] = useState<"history" | "documents">("history");

  const [eventOpen, setEventOpen] = useState(false);
  const [ev, setEv] = useState({ type: "NOTE", title: "", details: "", effectiveDate: "" });

  const [docType, setDocType] = useState<string>("OTHER");
  const [docExpiry, setDocExpiry] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ employees: EmployeeRow[]; withoutProfile: UnprofiledUser[] }>(
        "/api/hr/employees?includeExited=true",
      );
      setEmployees(data.employees);
      setUnprofiled(data.withoutProfile);
      setNewUserId(data.withoutProfile[0]?.id ?? "");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (row: EmployeeRow) => {
      setDetail(row);
      setTab("history");
      setDocs([]);
      try {
        const d = await api<{ employee: { events: HrEvent[] } }>(`/api/hr/employees/${row.id}`);
        setEvents(d.employee.events);
      } catch (e) {
        toast.error((e as Error).message);
      }
      if (canSeeDocuments) {
        try {
          const d = await api<{ documents: HrDoc[] }>(`/api/hr/employees/${row.id}/documents`);
          setDocs(d.documents);
        } catch {
          // Non-fatal: the history still renders.
        }
      }
    },
    [canSeeDocuments],
  );

  async function createProfile() {
    setSaving(true);
    try {
      await api("/api/hr/employees", {
        method: "POST",
        json: {
          userId: newUserId,
          department: form.department || null,
          designation: form.designation || null,
          shift: form.shift || null,
          joinedAt: form.joinedAt || null,
        },
      });
      toast.success("Employee record created.");
      setCreateOpen(false);
      setForm({ department: "", designation: "", shift: "", joinedAt: "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addEvent() {
    if (!detail) return;
    setSaving(true);
    try {
      await api(`/api/hr/employees/${detail.id}/events`, {
        method: "POST",
        json: {
          type: ev.type,
          title: ev.title,
          details: ev.details || null,
          effectiveDate: ev.effectiveDate || new Date().toISOString(),
        },
      });
      toast.success("Added to the employment record.");
      setEventOpen(false);
      setEv({ type: "NOTE", title: "", details: "", effectiveDate: "" });
      await openDetail(detail);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoc() {
    if (!detail) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file first.");
      return;
    }

    setSaving(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("docType", docType);
    if (docExpiry) fd.append("expiresAt", docExpiry);

    try {
      const res = await fetch(`/api/hr/employees/${detail.id}/documents`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.message ?? "Upload failed.");
        return;
      }
      toast.success("Document stored.");
      if (fileRef.current) fileRef.current.value = "";
      setDocExpiry("");
      await openDetail(detail);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const active = employees.filter((e) => !e.exitedAt);

  return (
    <>
      <PageHeader
        title="Employees"
        requirement="HR-01"
        description={
          canSeeDocuments
            ? "Profiles, documents and employment history."
            : "Profiles and employment history. HR documents are restricted and not shown here (HR-07)."
        }
        action={
          canManage && unprofiled.length > 0 ? (
            <Button onClick={() => setCreateOpen(true)}>
              Add employee record ({unprofiled.length})
            </Button>
          ) : undefined
        }
      />

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : employees.length === 0 ? (
        <EmptyState>
          No employee records yet. {unprofiled.length} user
          {unprofiled.length === 1 ? "" : "s"} without one.
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {active.length} active · {employees.length - active.length} former
            {unprofiled.length > 0 ? ` · ${unprofiled.length} user(s) with no record` : ""}
          </p>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow
                    key={e.id}
                    onClick={() => void openDetail(e)}
                    className={`cursor-pointer ${e.exitedAt ? "opacity-55" : ""}`}
                  >
                    <TableCell>
                      <div className="font-medium">{e.user.fullName}</div>
                      <div className="text-xs text-muted-foreground">{e.user.email}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.user.employeeCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{e.designation ?? "—"}</TableCell>
                    <TableCell className="text-sm">{e.department ?? "—"}</TableCell>
                    <TableCell className="text-sm">{e.shift ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmt(e.joinedAt)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {e._count.events} history
                      {canSeeDocuments ? ` · ${e._count.documents} docs` : ""}
                      {e.exitedAt ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          former
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* --- create profile --- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add employee record</DialogTitle>
            <DialogDescription>
              Name, email and employee code come from the user account and are not repeated here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-user">User</Label>
              <NativeSelect
                id="e-user"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
              >
                {unprofiled.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} — {u.role.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-desig">Designation</Label>
                <Input
                  id="e-desig"
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-dept">Department</Label>
                <Input
                  id="e-dept"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-shift">Shift</Label>
                <Input
                  id="e-shift"
                  placeholder="09:00-18:00"
                  value={form.shift}
                  onChange={(e) => setForm({ ...form, shift: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-joined">Joined</Label>
                <Input
                  id="e-joined"
                  type="date"
                  value={form.joinedAt}
                  onChange={(e) => setForm({ ...form, joinedAt: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createProfile()} disabled={saving || !newUserId}>
              {saving ? "Creating…" : "Create record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- detail --- */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.user.fullName}</DialogTitle>
            <DialogDescription>
              {[detail?.designation, detail?.department, detail?.shift]
                .filter(Boolean)
                .join(" · ") || "No designation recorded"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 border-b">
            <button
              onClick={() => setTab("history")}
              className={`px-3 py-1.5 text-sm ${tab === "history" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            >
              History ({events.length})
            </button>
            {canSeeDocuments ? (
              <button
                onClick={() => setTab("documents")}
                className={`px-3 py-1.5 text-sm ${tab === "documents" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                Documents ({docs.length})
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {tab === "history" ? (
              <>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mb-3"
                    onClick={() => setEventOpen(true)}
                  >
                    Add record
                  </Button>
                ) : null}
                {events.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No history recorded.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {events.map((e) => (
                      <div key={e.id} className="rounded-md border p-2.5">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {e.type}
                          </Badge>
                          <span className="text-sm font-medium">{e.title}</span>
                        </div>
                        {e.details ? (
                          <p className="mt-1 text-sm text-muted-foreground">{e.details}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {fmt(e.effectiveDate)} · recorded by {e.recordedBy.fullName}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-3 space-y-2 rounded-md border p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <NativeSelect value={docType} onChange={(e) => setDocType(e.target.value)}>
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      type="date"
                      value={docExpiry}
                      onChange={(e) => setDocExpiry(e.target.value)}
                      title="Optional expiry"
                    />
                  </div>
                  <input ref={fileRef} type="file" className="w-full text-sm" />
                  <Button size="sm" onClick={() => void uploadDoc()} disabled={saving}>
                    {saving ? "Uploading…" : "Upload"}
                  </Button>
                </div>

                {docs.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No documents stored.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {docs.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {d.docType.replace(/_/g, " ")}
                            </Badge>
                            <span className="truncate text-sm">{d.fileName}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {kb(d.sizeBytes)} · {fmt(d.uploadedAt)} · {d.uploadedBy.fullName}
                            {d.expiresAt ? ` · expires ${fmt(d.expiresAt)}` : ""}
                          </p>
                        </div>
                        <a
                          href={`/api/hr/documents/${d.id}`}
                          className="shrink-0 text-xs font-medium underline"
                        >
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- add history record --- */}
      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to employment record</DialogTitle>
            <DialogDescription>
              Records cannot be edited or deleted afterwards — corrections are added as a
              further note.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-type">Type</Label>
                <NativeSelect
                  id="ev-type"
                  value={ev.type}
                  onChange={(e) => setEv({ ...ev, type: e.target.value })}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-date">Effective date</Label>
                <Input
                  id="ev-date"
                  type="date"
                  value={ev.effectiveDate}
                  onChange={(e) => setEv({ ...ev, effectiveDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-title">Title</Label>
              <Input
                id="ev-title"
                value={ev.title}
                onChange={(e) => setEv({ ...ev, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-details">Details</Label>
              <textarea
                id="ev-details"
                rows={4}
                value={ev.details}
                onChange={(e) => setEv({ ...ev, details: e.target.value })}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEventOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void addEvent()} disabled={saving || !ev.title.trim()}>
              {saving ? "Saving…" : "Add record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
