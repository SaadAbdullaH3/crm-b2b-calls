"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * CL-05 / CL-06 / CL-08 — record the outcome of a call.
 *
 * The six outcomes and their behaviour flags come from the server
 * (`/api/dispositions`), not a hard-coded list here, so the modal and the API
 * cannot disagree about which outcome requires a callback.
 *
 * Two outcomes get extra friction on purpose:
 *   * Call Back Later blocks Save until a future date and time is set (CL-06).
 *     The server enforces the same rule; this only spares the round trip.
 *   * Do Not Call asks for explicit confirmation, because it permanently
 *     removes the lead from the callable pool for everyone (CL-05).
 */

export interface Disposition {
  id: string;
  code: string;
  label: string;
  description: string | null;
  isFollowUp: boolean;
  requiresCallback: boolean;
  blocksCalling: boolean;
}

interface LeadLike {
  id: string;
  companyName: string | null;
  contactName: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
}

/** Local datetime string for <input type="datetime-local">, one hour ahead. */
function defaultCallbackValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DispositionDialog({
  lead,
  dispositions,
  callId,
  open,
  onOpenChange,
  onSaved,
}: {
  lead: LeadLike | null;
  dispositions: Disposition[];
  callId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState(defaultCallbackValue);
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The dialog fades out rather than vanishing, and the parent clears the lead
   * as soon as the save succeeds — so without this the header flashes its
   * "this lead" fallback for the length of the exit animation. Holding the last
   * non-null lead keeps the closing frame showing what was actually saved.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [open]);
  const [lastLead, setLastLead] = useState<LeadLike | null>(null);
  useEffect(() => {
    if (lead) setLastLead(lead);
  }, [lead]);
  const shown = lead ?? lastLead;

  // Reset every time the dialog opens for a new lead, so a previous outcome or
  // note can never carry over onto the wrong record.
  useEffect(() => {
    if (open) {
      setCode(null);
      setNotes("");
      setCallbackAt(defaultCallbackValue());
      setConfirmDnc(false);
      setError(null);
    }
  }, [open, lead?.id]);

  const selected = dispositions.find((d) => d.code === code) ?? null;
  const needsCallback = Boolean(selected?.requiresCallback);
  const isDnc = Boolean(selected?.blocksCalling);

  /**
   * Ticked, not read during render. An agent can sit on this modal past the
   * time they just picked — computing it once during render leaves Save
   * enabled on a callback that is now in the past, and the only thing catching
   * it is the server's 400.
   */
  const callbackInPast =
    needsCallback && callbackAt ? new Date(callbackAt).getTime() <= now : false;

  const canSave =
    Boolean(selected) &&
    !saving &&
    (!needsCallback || (Boolean(callbackAt) && !callbackInPast)) &&
    (!isDnc || confirmDnc);

  async function save() {
    if (!lead || !selected) return;
    setSaving(true);
    setError(null);
    try {
      await api("/api/calls/disposition", {
        method: "POST",
        json: {
          leadId: lead.id,
          callId,
          code: selected.code,
          notes: notes.trim() || null,
          callbackAt: needsCallback ? new Date(callbackAt).toISOString() : null,
        },
      });

      toast.success(`Saved: ${selected.label}`, {
        description: isDnc
          ? "This lead will not be called again unless Management overrides it."
          : needsCallback
            ? `Callback scheduled for ${new Date(callbackAt).toLocaleString()}.`
            : undefined,
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that outcome.");
    } finally {
      setSaving(false);
    }
  }

  const who =
    shown?.companyName ?? shown?.contactName ?? shown?.phoneRaw ?? "this lead";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Call outcome</DialogTitle>
          <DialogDescription>
            {who}
            {shown?.contactName && shown?.companyName ? ` · ${shown.contactName}` : ""}
            {shown?.phoneRaw ? ` · ${shown.phoneRaw}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>What happened?</Label>
            <div className="grid grid-cols-2 gap-2">
              {dispositions.map((d) => (
                <Button
                  key={d.code}
                  type="button"
                  variant={code === d.code ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => {
                    setCode(d.code);
                    setConfirmDnc(false);
                  }}
                >
                  {d.label}
                </Button>
              ))}
            </div>
            {selected?.description ? (
              <p className="text-xs text-muted-foreground">{selected.description}</p>
            ) : null}
          </div>

          {needsCallback ? (
            <div className="space-y-2">
              <Label htmlFor="callbackAt">
                Callback date and time <span className="text-destructive">*</span>
              </Label>
              <Input
                id="callbackAt"
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                className="w-64"
              />
              {callbackInPast ? (
                <p className="text-xs text-destructive">
                  That time has already passed — pick a future time.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Required. You will be reminded when it is due, whether or not this
                  tab is open.
                </p>
              )}
            </div>
          ) : null}

          {isDnc ? (
            <label className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmDnc}
                onChange={(e) => setConfirmDnc(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm this contact asked not to be called again. The lead is
                removed from the callable pool for <strong>everyone</strong> and can
                only be restored by Management.
              </span>
            </label>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What was said, and anything the next call should know."
              className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>

          <ErrorNote message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Saving..." : "Save outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
