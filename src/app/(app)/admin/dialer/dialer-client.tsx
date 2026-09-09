"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, ErrorNote, api } from "@/components/admin/admin-ui";

/**
 * AD-06 — VC Dialer configuration.
 *
 * Credentials are write-only: the GET never returns them, so the fields here
 * start blank and are only sent when the Admin types a new value. The screen
 * reports whether a secret is stored, not what it is.
 *
 * CL-03 makes the clipboard fallback mandatory, so that toggle is rendered
 * locked on rather than merely defaulted on — it is not the Admin's to switch
 * off, and showing it greyed explains why.
 */

interface DialerConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  clipboardFallback: boolean;
}

interface SettingRow {
  key: string;
  label: string;
  description: string;
  isSecret: boolean;
  value: unknown;
  isConfigured: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
}

export function DialerClient() {
  const [config, setConfig] = useState<DialerConfig | null>(null);
  const [credsStored, setCredsStored] = useState(false);
  const [credsMeta, setCredsMeta] = useState<SettingRow | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ settings: SettingRow[] }>(
        "/api/admin/settings?category=dialer",
      );
      const cfg = data.settings.find((s) => s.key === "dialer.config");
      const creds = data.settings.find((s) => s.key === "dialer.credentials");
      setConfig(cfg?.value as DialerConfig);
      setCredsStored(Boolean(creds?.isConfigured));
      setCredsMeta(creds ?? null);
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
    if (!config) return;
    setSaving(true);

    const updates: { key: string; value: unknown }[] = [
      { key: "dialer.config", value: { ...config, clipboardFallback: true } },
    ];

    // Only send credentials when something was actually typed — an empty form
    // must not wipe stored keys.
    if (apiKey || apiSecret) {
      updates.push({ key: "dialer.credentials", value: { apiKey, apiSecret } });
    }

    try {
      await api("/api/admin/settings", { method: "PUT", json: { updates } });
      toast.success("Dialer settings saved.");
      setApiKey("");
      setApiSecret("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!config) return <ErrorNote message={error ?? "Could not load dialer settings."} />;

  return (
    <>
      <PageHeader
        title="Dialer Settings"
        requirement="AD-06"
        description="Connection details for the VC Dialer service. Dev A's Call button reads these on Day 5."
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
            <CardTitle className="text-base">Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
              <span className="font-medium">Direct dialling enabled</span>
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">
              Leave off until VC Dialer credentials are confirmed working. While off,
              the Call button uses the clipboard fallback.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="provider">Provider</Label>
              <Input
                id="provider"
                value={config.provider}
                onChange={(e) => setConfig({ ...config, provider: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="baseUrl">API base URL</Label>
              <Input
                id="baseUrl"
                value={config.baseUrl}
                placeholder="https://api.example.com"
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              />
            </div>

            <div className="rounded-md border border-dashed p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked
                  disabled
                  readOnly
                />
                <span className="font-medium">Copy number to clipboard as fallback</span>
                <Badge variant="outline" className="text-[10px]">
                  CL-03
                </Badge>
              </label>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Mandatory by specification and cannot be switched off. If direct
                integration is unavailable for any reason, the agent must still be able
                to place the call.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Credentials
              {credsStored ? (
                <Badge variant="secondary" className="text-[10px]">
                  stored
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  not set
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Write-only. Saved credentials are never sent back to the browser, so these
              fields stay blank. Leave them empty to keep what is already stored.
              {credsMeta?.updatedAt ? (
                <>
                  {" "}
                  Last updated {new Date(credsMeta.updatedAt).toLocaleString()}
                  {credsMeta.updatedBy ? ` by ${credsMeta.updatedBy.fullName}` : ""}.
                </>
              ) : null}
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="apiKey">API key</Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={credsStored ? "•••••••• (unchanged)" : "Not set"}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="apiSecret">API secret</Label>
              <Input
                id="apiSecret"
                type="password"
                autoComplete="off"
                value={apiSecret}
                placeholder={credsStored ? "•••••••• (unchanged)" : "Not set"}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
