"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, NativeSelect, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * AD-07 — time, shift and break configuration.
 *
 * `inactivityMinutes` is the value TM-03 hangs off. Day 4's idle sweep reads it
 * through getInactivityMs() rather than hard-coding 5, which is the whole
 * reason this screen exists ahead of the Monitoring Engine.
 */

interface MonitoringConfig {
  inactivityMinutes: number;
  heartbeatSeconds: number;
  breakMinutesPerShift: number;
  maxSingleBreakMinutes: number;
}

interface ShiftConfig {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  workingDays: number[];
  timeZone: string;
}

interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
];

export function SettingsClient() {
  const [monitoring, setMonitoring] = useState<MonitoringConfig | null>(null);
  const [shift, setShift] = useState<ShiftConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [mon, shf] = await Promise.all([
        api<{ settings: SettingRow[] }>("/api/admin/settings?category=monitoring"),
        api<{ settings: SettingRow[] }>("/api/admin/settings?category=shift"),
      ]);
      setMonitoring(mon.settings[0]?.value as MonitoringConfig);
      setShift(shf.settings[0]?.value as ShiftConfig);
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

  async function save() {
    if (!monitoring || !shift) return;
    setSaving(true);
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        json: {
          updates: [
            { key: "monitoring.config", value: monitoring },
            { key: "shift.config", value: shift },
          ],
        },
      });
      toast.success("Settings saved. The idle sweep picks these up on its next tick.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(d: number) {
    if (!shift) return;
    const has = shift.workingDays.includes(d);
    setShift({
      ...shift,
      workingDays: has
        ? shift.workingDays.filter((x) => x !== d)
        : [...shift.workingDays, d].sort(),
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!monitoring || !shift) {
    return <ErrorNote message={error ?? "Could not load settings."} />;
  }

  return (
    <>
      <PageHeader
        title="Time & Breaks"
        requirement="AD-07"
        description="Shift window, lateness grace and the activity rules the Monitoring Engine runs on."
        action={
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        }
      />

      <ErrorNote message={error} />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Activity detection
              <Badge variant="outline" className="text-[10px]">
                TM-03
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inactivity">Inactivity threshold (minutes)</Label>
                <Input
                  id="inactivity"
                  type="number"
                  min={1}
                  max={120}
                  value={monitoring.inactivityMinutes}
                  onChange={(e) =>
                    setMonitoring({
                      ...monitoring,
                      inactivityMinutes: Number(e.target.value),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Active Time stops after this long with no qualifying activity. The SRS
                  default is 5.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="heartbeat">Heartbeat interval (seconds)</Label>
                <Input
                  id="heartbeat"
                  type="number"
                  min={5}
                  max={300}
                  value={monitoring.heartbeatSeconds}
                  onChange={(e) =>
                    setMonitoring({
                      ...monitoring,
                      heartbeatSeconds: Number(e.target.value),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How often a browser reports activity. Must be shorter than the
                  threshold above.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Breaks
              <Badge variant="outline" className="text-[10px]">
                TM-04
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="breakTotal">Break allowance per shift (minutes)</Label>
              <Input
                id="breakTotal"
                type="number"
                min={0}
                max={480}
                value={monitoring.breakMinutesPerShift}
                onChange={(e) =>
                  setMonitoring({
                    ...monitoring,
                    breakMinutesPerShift: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="breakMax">Longest single break (minutes)</Label>
              <Input
                id="breakMax"
                type="number"
                min={0}
                max={480}
                value={monitoring.maxSingleBreakMinutes}
                onChange={(e) =>
                  setMonitoring({
                    ...monitoring,
                    maxSingleBreakMinutes: Number(e.target.value),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Working shift
              <Badge variant="outline" className="text-[10px]">
                MG-07
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start">Start</Label>
                <Input
                  id="start"
                  type="time"
                  value={shift.startTime}
                  onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">End</Label>
                <Input
                  id="end"
                  type="time"
                  value={shift.endTime}
                  onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grace">Grace (minutes)</Label>
                <Input
                  id="grace"
                  type="number"
                  min={0}
                  max={120}
                  value={shift.graceMinutes}
                  onChange={(e) =>
                    setShift({ ...shift, graceMinutes: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Working days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = shift.workingDays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={
                        on
                          ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                          : "rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tz">Business time zone</Label>
              <NativeSelect
                id="tz"
                value={shift.timeZone}
                onChange={(e) => setShift({ ...shift, timeZone: e.target.value })}
              >
                {TIME_ZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                NF-09: timestamps are stored in UTC and displayed in this zone. Reports
                that cross a DST boundary depend on getting this right.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
