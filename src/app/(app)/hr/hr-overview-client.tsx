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
import { PageHeader, NativeSelect, EmptyState, api } from "@/components/admin/admin-ui";

/**
 * HR overview + HR-04 attendance.
 *
 * !! TM-05 !! Attendance here means login, logout and lateness — facts about
 * whether someone turned up. It deliberately does NOT show Active Time, Idle
 * Time, Break Time or Productivity: those are Management-only and live on
 * /management/monitoring behind `monitoring.view`. HR-04 grants "attendance
 * and punctuality records", which is a narrower thing, and the API enforces
 * the same split.
 */

interface AttendanceRow {
  user: { id: string; fullName: string; role: { label: string } };
  date: string;
  firstLoginAt: string;
  lastSeenAt: string | null;
  sessionCount: number;
  lateMinutes: number;
  stillIn: boolean;
}

interface ExpiringDoc {
  id: string;
  fileName: string;
  docType: string;
  expiresAt: string;
  employeeName: string;
}

function time(d: string | null) {
  return d ? new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
}

export function HrOverviewClient({
  canSeeAttendance,
  stats,
  expiring,
}: {
  canSeeAttendance: boolean;
  stats: {
    employees: number;
    former: number;
    pendingLeave: number;
    holidays: number;
    documents: number | null;
  };
  expiring: ExpiringDoc[];
}) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [days, setDays] = useState("7");
  const [shiftStart, setShiftStart] = useState("09:00");
  const [grace, setGrace] = useState(10);
  const [loading, setLoading] = useState(canSeeAttendance);

  const load = useCallback(async () => {
    if (!canSeeAttendance) return;
    try {
      const data = await api<{
        attendance: AttendanceRow[];
        shiftStart: string;
        graceMinutes: number;
      }>(`/api/hr/attendance?days=${days}`);
      setRows(data.attendance);
      setShiftStart(data.shiftStart);
      setGrace(data.graceMinutes);
    } finally {
      setLoading(false);
    }
  }, [days, canSeeAttendance]);

  useEffect(() => {
    void load();
  }, [load]);

  const late = rows.filter((r) => r.lateMinutes > 0).length;

  return (
    <>
      <PageHeader
        title="HR"
        description="Employee records, documents, leave and attendance."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/hr/employees">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Employees</p>
              <p className="text-2xl font-semibold">{stats.employees}</p>
              {stats.former > 0 ? (
                <p className="text-[10px] text-muted-foreground">{stats.former} former</p>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        <Link href="/leave">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Leave awaiting review</p>
              <p className="text-2xl font-semibold">{stats.pendingLeave}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/hr/holidays">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Holidays</p>
              <p className="text-2xl font-semibold">{stats.holidays}</p>
            </CardContent>
          </Card>
        </Link>

        {stats.documents !== null ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Documents on file</p>
              <p className="text-2xl font-semibold">{stats.documents}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {expiring.length > 0 ? (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="mb-2 text-sm font-medium">Documents expiring within 30 days</p>
          <div className="space-y-1">
            {expiring.map((d) => (
              <p key={d.id} className="text-sm">
                <span className="font-medium">{d.employeeName}</span> —{" "}
                {d.docType.replace(/_/g, " ").toLowerCase()} ({d.fileName}), expires{" "}
                {new Date(d.expiresAt).toLocaleDateString()}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {canSeeAttendance ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Attendance & punctuality</h2>
              <p className="text-xs text-muted-foreground">
                HR-04 · shift starts {shiftStart}, {grace} minute grace period.
                {late > 0 ? ` ${late} late arrival${late === 1 ? "" : "s"} in this period.` : ""}
              </p>
            </div>
            <div className="w-40">
              <NativeSelect value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">Today</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </NativeSelect>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState>
              No sign-ins recorded in this period. Attendance is derived from login
              sessions.
            </EmptyState>
          ) : (
            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>First login</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead>Punctuality</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.user.id}-${r.date}`}>
                      <TableCell>
                        <div className="font-medium">{r.user.fullName}</div>
                        <div className="text-xs text-muted-foreground">{r.user.role.label}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(r.date).toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {time(r.firstLoginAt)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {r.stillIn ? (
                          <Badge className="bg-emerald-600 text-white">still in</Badge>
                        ) : (
                          time(r.lastSeenAt)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.sessionCount}</TableCell>
                      <TableCell>
                        {r.lateMinutes > 0 ? (
                          <Badge className="bg-amber-500 text-white">
                            {r.lateMinutes} min late
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">on time</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
