"use client";

import { useCallback, useEffect, useState } from "react";
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
import { PageHeader, EmptyState, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * SF-03 (timeline) and SF-04 (assignment history) for one lead, plus the
 * Do-Not-Call override.
 *
 * Shared by Management and agents. What each sees is decided by the API, not by
 * props: an agent gets the timeline of their own lead and no assignment
 * history, so this component simply renders whichever sections came back.
 */

interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail?: string;
  actor?: { id: string; fullName: string } | null;
}

interface TimelineLead {
  id: string;
  companyName: string | null;
  contactName: string | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  email: string | null;
  status: string;
  doNotCall: boolean;
  sourceLabel: string | null;
  assignedTo: { id: string; fullName: string } | null;
}

interface Assignment {
  id: string;
  assignedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  method: string;
  notes: string | null;
  assignedTo: { id: string; fullName: string; email: string };
  assignedBy: { id: string; fullName: string } | null;
  isCurrent: boolean;
}

const KIND_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  IMPORTED: "outline",
  CREATED: "outline",
  ASSIGNED: "default",
  RELEASED: "secondary",
  CALL: "secondary",
  CALLBACK_SCHEDULED: "secondary",
  CALLBACK_DONE: "outline",
  CALLBACK_MISSED: "destructive",
  DO_NOT_CALL: "destructive",
  MODIFIED: "outline",
};

export function LeadDetail({
  leadId,
  canOverrideDnc,
  canSeeAssignments,
  backHref,
}: {
  leadId: string;
  canOverrideDnc: boolean;
  canSeeAssignments: boolean;
  backHref: string;
}) {
  const [lead, setLead] = useState<TimelineLead | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const timeline = await api<{ lead: TimelineLead; events: TimelineEvent[] }>(
        `/api/leads/${leadId}/timeline`,
      );
      setLead(timeline.lead);
      setEvents(timeline.events);
      setError(null);

      if (canSeeAssignments) {
        const hist = await api<{ assignments: Assignment[] }>(
          `/api/leads/${leadId}/assignments`,
        );
        setAssignments(hist.assignments);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this lead.");
    } finally {
      setLoading(false);
    }
  }, [leadId, canSeeAssignments]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleDnc(next: boolean) {
    if (
      !next &&
      !window.confirm(
        "Restore this lead to the callable pool? It was suppressed because the contact asked not to be called.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/leads/${leadId}/do-not-call`, {
        method: "PATCH",
        json: { doNotCall: next },
      });
      toast.success(next ? "Marked Do Not Call." : "Restored to the callable pool.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change that.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <EmptyState>Loading...</EmptyState>;
  if (!lead) return <ErrorNote message={error ?? "Lead not found."} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={lead.companyName ?? lead.contactName ?? "Lead"}
        requirement="SF-03"
        description={[lead.contactName, lead.phoneRaw ?? lead.phoneE164, lead.email]
          .filter(Boolean)
          .join(" · ")}
        action={
          <a href={backHref} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant={lead.doNotCall ? "destructive" : "secondary"}>
          {lead.status.replace(/_/g, " ").toLowerCase()}
        </Badge>
        {lead.sourceLabel ? <Badge variant="outline">{lead.sourceLabel}</Badge> : null}
        {lead.assignedTo ? (
          <span className="text-sm text-muted-foreground">
            held by {lead.assignedTo.fullName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">unassigned</span>
        )}
      </div>

      {lead.doNotCall ? (
        <div className="mb-6 rounded-md bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Do Not Call</p>
          <p className="mt-1 text-sm">
            This contact asked not to be called. The lead is excluded from the
            available pool, from every agent&apos;s call list, and from manual
            assignment.
          </p>
          {canOverrideDnc ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={busy}
              onClick={() => toggleDnc(false)}
            >
              Restore to callable pool
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Only Management or an Admin can restore it.
            </p>
          )}
        </div>
      ) : canOverrideDnc ? (
        <div className="mb-6">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleDnc(true)}>
            Mark Do Not Call
          </Button>
        </div>
      ) : null}

      <ErrorNote message={error} />

      <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
      {events.length === 0 ? (
        <EmptyState>Nothing has happened to this lead yet.</EmptyState>
      ) : (
        <ol className="mb-10 space-y-3 border-l pl-5">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative">
              <span className="absolute -left-[1.42rem] top-2 size-2 rounded-full bg-border" />
              <div className="flex flex-wrap items-baseline gap-2">
                <Badge variant={KIND_TONE[e.kind] ?? "secondary"}>
                  {e.kind.replace(/_/g, " ").toLowerCase()}
                </Badge>
                <span className="text-sm font-medium">{e.title}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()}
                </span>
              </div>
              {e.detail ? (
                <p className="mt-1 text-sm text-muted-foreground">{e.detail}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {e.actor ? e.actor.fullName : "system"}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canSeeAssignments && assignments ? (
        <>
          <h2 className="mb-3 text-sm font-semibold">
            Assignment history{" "}
            <span className="font-normal text-muted-foreground">(SF-04)</span>
          </h2>
          {assignments.length === 0 ? (
            <EmptyState>This lead has never been assigned.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Held by</TableHead>
                    <TableHead>How</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Until</TableHead>
                    <TableHead>Assigned by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-medium">{a.assignedTo.fullName}</div>
                        {a.isCurrent ? (
                          <Badge variant="default" className="mt-1">
                            current
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.method.replace(/_/g, " ").toLowerCase()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(a.assignedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.releasedAt ? (
                          <>
                            {new Date(a.releasedAt).toLocaleString()}
                            <div className="text-xs text-muted-foreground">
                              {a.releaseReason?.replace(/_/g, " ").toLowerCase()}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">still held</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.assignedBy?.fullName ?? "system"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
