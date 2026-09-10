"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { DispositionDialog, type Disposition } from "@/components/calling/disposition-dialog";

/**
 * CL-01 / CL-02 / CL-03 — the agent's calling workspace.
 *
 * TM-05 BOUNDARY: this is an Agent screen. It shows call counts and outcomes
 * and nothing else — no Active Time, Idle Time, Break/Pause Time or
 * Productivity %. Those belong to Management's monitoring view.
 */

interface Lead {
  id: string;
  companyName: string | null;
  contactName: string | null;
  jobTitle: string | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  sourceLabel: string | null;
  status: string;
  callAttempts: number;
  lastDispositionCode: string | null;
  lastDispositionAt: string | null;
  nextCallbackAt: string | null;
}

interface Handoff {
  mode: "DIALER" | "CLIPBOARD";
  phone: string;
  display: string;
  dialUrl?: string;
  reason?: string;
}

/** An in-flight call: the row is open, the outcome is not yet saved. */
interface ActiveCall {
  callId: string;
  lead: Lead;
  handoff: Handoff;
  /** False when the browser refused clipboard access — we then show the number. */
  copied: boolean;
}

export function CallListClient() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [workedToday, setWorkedToday] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [dialogLead, setDialogLead] = useState<Lead | null>(null);
  /**
   * "Now", ticked rather than read during render. Reading the clock while
   * rendering is impure: the overdue flag would freeze at whatever the first
   * render happened to see and only correct itself on an unrelated re-render.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<{ leads: Lead[]; workedToday: number }>(
        `/api/agent/call-list${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
      );
      setLeads(data.leads);
      setWorkedToday(data.workedToday);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your call list.");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ dispositions: Disposition[] }>("/api/dispositions")
      .then((d) => setDispositions(d.dispositions))
      .catch(() => setError("Could not load the outcome list."));
  }, []);

  /**
   * CL-02 / CL-03. The server decides dialer-vs-clipboard and opens the call
   * row; this only acts on that answer.
   *
   * Clipboard access can be refused outright (insecure origin, permission
   * denied, an unfocused document). That must not leave the agent stranded, so
   * a failure downgrades to showing the number in a selectable field rather
   * than silently doing nothing.
   */
  async function placeCall(lead: Lead) {
    setBusyLead(lead.id);
    setError(null);
    try {
      const res = await api<{ call: { id: string }; handoff: Handoff }>("/api/calls", {
        method: "POST",
        json: { leadId: lead.id },
      });

      let copied = false;
      if (res.handoff.mode === "DIALER" && res.handoff.dialUrl) {
        window.open(res.handoff.dialUrl, "_blank", "noopener");
        toast.success(`Handed off to the dialer: ${res.handoff.display}`);
      } else {
        try {
          await navigator.clipboard.writeText(res.handoff.phone);
          copied = true;
          toast.success(`${res.handoff.display} copied to your clipboard`, {
            description: "Paste it into your phone or softphone to dial.",
          });
        } catch {
          toast.warning("Your browser blocked clipboard access", {
            description: "The number is shown below — copy it manually.",
          });
        }
      }

      setActive({
        callId: res.call.id,
        lead,
        handoff: res.handoff,
        copied,
      });
      setDialogLead(lead);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start that call.");
    } finally {
      setBusyLead(null);
    }
  }

  function outcomeOnly(lead: Lead) {
    setActive(null);
    setDialogLead(lead);
  }

  async function afterSave() {
    setActive(null);
    setDialogLead(null);
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Call List"
        requirement="CL-01"
        description="Your assigned leads, in the order worth working: overdue callbacks first, then leads you have not tried yet."
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company, contact, phone or email"
          className="w-72"
          aria-label="Search your leads"
        />
        <p className="text-sm text-muted-foreground">
          <strong>{leads.length}</strong> to call ·{" "}
          <strong>{workedToday}</strong> worked today
        </p>
      </div>

      {active && !active.copied && active.handoff.mode === "CLIPBOARD" ? (
        <div className="mb-4 rounded-md border border-dashed p-3">
          <p className="text-sm font-medium">
            Copy this number manually — the browser blocked the clipboard:
          </p>
          <input
            readOnly
            value={active.handoff.phone}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-56 rounded border bg-background px-2 py-1 font-mono text-lg"
          />
        </div>
      ) : null}

      <ErrorNote message={error} />

      {loading ? (
        <EmptyState>Loading...</EmptyState>
      ) : leads.length === 0 ? (
        <EmptyState>
          Nothing left to call. Request more leads from the Request Leads screen.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Last outcome</TableHead>
                <TableHead className="w-56">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const overdue =
                  lead.nextCallbackAt && new Date(lead.nextCallbackAt).getTime() < now;
                return (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Link
                        href={`/agent/leads/${lead.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                        title="See this lead's history before you call"
                      >
                        {lead.companyName ?? lead.contactName ?? "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[lead.contactName, lead.jobTitle].filter(Boolean).join(" · ") ||
                          "—"}
                      </div>
                      {lead.sourceLabel ? (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {lead.sourceLabel}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {lead.phoneRaw ?? lead.phoneE164 ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {lead.callAttempts}
                    </TableCell>
                    <TableCell>
                      {lead.lastDispositionCode ? (
                        <Badge variant="secondary">
                          {lead.lastDispositionCode.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">not tried</span>
                      )}
                      {lead.nextCallbackAt ? (
                        <div
                          className={`mt-1 text-[11px] ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                        >
                          {overdue ? "Callback overdue: " : "Callback: "}
                          {new Date(lead.nextCallbackAt).toLocaleString()}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={busyLead === lead.id || !lead.phoneE164}
                          onClick={() => placeCall(lead)}
                          title={
                            lead.phoneE164
                              ? undefined
                              : "This lead has no valid U.S. phone number."
                          }
                        >
                          {busyLead === lead.id ? "..." : "Call"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => outcomeOnly(lead)}
                        >
                          Outcome
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <DispositionDialog
        lead={dialogLead}
        dispositions={dispositions}
        callId={active?.callId ?? null}
        open={Boolean(dialogLead)}
        onOpenChange={(open) => {
          if (!open) {
            setDialogLead(null);
            setActive(null);
          }
        }}
        onSaved={afterSave}
      />
    </div>
  );
}
