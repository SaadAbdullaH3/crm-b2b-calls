"use client";

import { useEffect, useState, useCallback } from "react";
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
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/** HR-05 — the holiday calendar that leave day counts are computed against. */

interface Holiday {
  id: string;
  name: string;
  date: string;
  isRecurring: boolean;
  description: string | null;
  createdBy: { fullName: string } | null;
}

export function HolidaysClient({ canManage }: { canManage: boolean }) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    date: "",
    isRecurring: false,
    description: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await api<{ holidays: Holiday[] }>(`/api/hr/holidays?year=${year}`);
      setHolidays(data.holidays);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setSaving(true);
    try {
      await api("/api/hr/holidays", { method: "POST", json: form });
      toast.success(`${form.name} added.`);
      setOpen(false);
      setForm({ name: "", date: "", isRecurring: false, description: "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(h: Holiday) {
    try {
      await api(`/api/hr/holidays/${h.id}`, { method: "DELETE" });
      toast.success(`${h.name} removed.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Holiday Calendar"
        requirement="HR-05"
        description="Holidays falling on a working day are skipped when counting leave. A request already submitted keeps the count it was given at the time, so editing this calendar never rewrites past leave."
        action={
          canManage ? <Button onClick={() => setOpen(true)}>Add holiday</Button> : undefined
        }
      />

      <ErrorNote message={error} />

      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setYear(year - 1)}>
          Previous
        </Button>
        <span className="min-w-16 text-center text-sm font-medium tabular-nums">{year}</span>
        <Button size="sm" variant="outline" onClick={() => setYear(year + 1)}>
          Next
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : holidays.length === 0 ? (
        <EmptyState>No holidays recorded for {year}.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holiday</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Repeats</TableHead>
                {canManage ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <div className="font-medium">{h.name}</div>
                    {h.description ? (
                      <div className="text-xs text-muted-foreground">{h.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(h.date).toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "long",
                      ...(h.isRecurring ? {} : { year: "numeric" }),
                    })}
                  </TableCell>
                  <TableCell>
                    {h.isRecurring ? (
                      <Badge variant="secondary" className="text-[10px]">
                        every year
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">one-off</span>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void remove(h)}>
                        Remove
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add holiday</DialogTitle>
            <DialogDescription>
              Mark it recurring only if it falls on the same calendar date every year. A moving
              holiday needs one entry per year.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="h-name">Name</Label>
              <Input
                id="h-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-date">Date</Label>
              <Input
                id="h-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={form.isRecurring}
                onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
              />
              Repeats on the same date every year
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="h-desc">Description</Label>
              <Input
                id="h-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()} disabled={saving || !form.name || !form.date}>
              {saving ? "Adding…" : "Add holiday"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
