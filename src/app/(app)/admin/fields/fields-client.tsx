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
import {
  PageHeader,
  NativeSelect,
  EmptyState,
  ErrorNote,
  api,
} from "@/components/admin/admin-ui";

/**
 * AD-05 — dynamic lead fields.
 *
 * Values land in `leads.custom_fields` keyed by `key`, so `key` is a contract
 * with Dev A's import mapper. It is immutable after creation and the form
 * says so — renaming would orphan every stored value silently.
 */

const TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "EMAIL",
  "PHONE",
  "URL",
] as const;

type FieldType = (typeof TYPES)[number];

const CHOICE_TYPES: FieldType[] = ["SELECT", "MULTISELECT"];

interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  isRequired: boolean;
  isActive: boolean;
  options: string[] | null;
  helpText: string | null;
  sortOrder: number;
}

/** Mirrors the server's FIELD_KEY regex so the error appears before submit. */
function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 40);
}

export function FieldsClient() {
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldRow | null>(null);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>("TEXT");
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");
  const [helpText, setHelpText] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ fields: FieldRow[] }>(
        "/api/admin/fields?includeInactive=true",
      );
      setFields(data.fields);
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

  function openCreate() {
    setEditing(null);
    setLabel("");
    setKey("");
    setKeyTouched(false);
    setType("TEXT");
    setIsRequired(false);
    setOptionsText("");
    setHelpText("");
    setOpen(true);
  }

  function openEdit(f: FieldRow) {
    setEditing(f);
    setLabel(f.label);
    setKey(f.key);
    setKeyTouched(true);
    setType(f.type);
    setIsRequired(f.isRequired);
    setOptionsText((f.options ?? []).join("\n"));
    setHelpText(f.helpText ?? "");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    const options = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (editing) {
        await api(`/api/admin/fields/${editing.id}`, {
          method: "PATCH",
          json: {
            label,
            isRequired,
            helpText,
            ...(CHOICE_TYPES.includes(editing.type) ? { options } : {}),
          },
        });
        toast.success(`${label} updated.`);
      } else {
        await api("/api/admin/fields", {
          method: "POST",
          json: {
            key: keyTouched ? key : keyFromLabel(label),
            label,
            type,
            isRequired,
            helpText,
            ...(CHOICE_TYPES.includes(type) ? { options } : {}),
          },
        });
        toast.success(`${label} created.`);
      }
      setOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(f: FieldRow, next: boolean) {
    try {
      if (next) {
        await api(`/api/admin/fields/${f.id}`, { method: "PATCH", json: { isActive: true } });
        toast.success(`${f.label} reactivated.`);
      } else {
        await api(`/api/admin/fields/${f.id}`, { method: "DELETE" });
        toast.success(`${f.label} retired. Existing lead values are kept.`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const effectiveKey = keyTouched ? key : keyFromLabel(label);

  return (
    <>
      <PageHeader
        title="Lead Fields"
        requirement="AD-05"
        description="Custom fields beyond the built-in lead columns. Dev A's import mapper offers every active field here as a mapping target, and values are stored on the lead itself."
        action={<Button onClick={openCreate}>New field</Button>}
      />

      <ErrorNote message={error} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : fields.length === 0 ? (
        <EmptyState>
          No custom fields yet. The built-in lead columns (company, contact, phone, email,
          website, address) always exist and don&apos;t need defining here.
        </EmptyState>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f.id} className={f.isActive ? "" : "opacity-55"}>
                  <TableCell className="font-medium">
                    {f.label}
                    {f.helpText ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {f.helpText}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {f.type}
                    </Badge>
                    {f.options?.length ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {f.options.length} options
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{f.isRequired ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    {f.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Retired</Badge>}
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(f)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void setActive(f, !f.isActive)}
                    >
                      {f.isActive ? "Retire" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit field" : "New lead field"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The key and type are fixed after creation — changing either would orphan values already stored on leads."
                : "The key is how this field is stored on every lead and referenced by the import mapper."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-label">Label</Label>
              <Input
                id="f-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Industry"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-key">Key</Label>
              <Input
                id="f-key"
                value={effectiveKey}
                disabled={Boolean(editing)}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits and underscores; must start with a letter.
                {editing ? " Fixed after creation." : " Auto-filled from the label."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-type">Type</Label>
                <NativeSelect
                  id="f-type"
                  value={type}
                  disabled={Boolean(editing)}
                  onChange={(e) => setType(e.target.value as FieldType)}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={isRequired}
                    onChange={(e) => setIsRequired(e.target.checked)}
                  />
                  Required
                </label>
              </div>
            </div>

            {CHOICE_TYPES.includes(editing?.type ?? type) ? (
              <div className="space-y-1.5">
                <Label htmlFor="f-options">Options</Label>
                <textarea
                  id="f-options"
                  rows={4}
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={"One per line\nTechnology\nHealthcare\nFinance"}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                />
                <p className="text-xs text-muted-foreground">One option per line.</p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="f-help">Help text</Label>
              <Input
                id="f-help"
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || label.trim() === ""}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
