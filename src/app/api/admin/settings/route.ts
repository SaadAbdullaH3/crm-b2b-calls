import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, parseBody } from "@/lib/api";
import {
  SETTINGS,
  SETTING_KEYS,
  getSetting,
  setSetting,
  isSecretSetting,
  type SettingKey,
} from "@/lib/settings";

/**
 * AD-06 / AD-07 / AD-08 / AD-09 — read and write system settings.
 *
 * Secret settings (dialer credentials) are WRITE-ONLY: GET reports whether a
 * value is set, never the value itself. An Admin screen has no legitimate need
 * to read a stored API secret back, and returning it would put the credential
 * in every browser cache and network log that touches this endpoint.
 */

export const GET = requirePermission("admin.settings.manage", async (req) => {
  const category = new URL(req.url).searchParams.get("category");

  const keys = category
    ? SETTING_KEYS.filter((k) => SETTINGS[k].category === category)
    : SETTING_KEYS;

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
    include: { updatedBy: { select: { id: true, fullName: true } } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const settings = await Promise.all(
    keys.map(async (key) => {
      const def = SETTINGS[key];
      const row = byKey.get(key);
      const secret = isSecretSetting(key);

      return {
        key,
        category: def.category,
        label: def.label,
        description: def.description,
        isSecret: secret,
        // For secrets: only whether one has been saved, never the value.
        value: secret ? null : await getSetting(key),
        isConfigured: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    }),
  );

  return ok({ settings });
});

const UpdateSettingsSchema = z.object({
  updates: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.unknown(),
      }),
    )
    .min(1),
});

export const PUT = requirePermission(
  "admin.settings.manage",
  async (req, { user: actor }) => {
    const parsed = await parseBody(req, UpdateSettingsSchema);
    if (!parsed.success) return parsed.res;

    const unknownKeys = parsed.data.updates
      .map((u) => u.key)
      .filter((k) => !SETTING_KEYS.includes(k as SettingKey));

    if (unknownKeys.length > 0) {
      return badRequest(
        `Unknown setting key(s): ${unknownKeys.join(", ")}. Add it to the registry in src/lib/settings.ts first.`,
      );
    }

    for (const { key, value } of parsed.data.updates) {
      const invalid = validate(key as SettingKey, value);
      if (invalid) return badRequest(`${key}: ${invalid}`);
    }

    for (const { key, value } of parsed.data.updates) {
      await setSetting(key as SettingKey, value, actor.id);
    }

    return ok({ updated: parsed.data.updates.map((u) => u.key) });
  },
);

/**
 * Per-key sanity checks for the values that drive real behaviour. A zero
 * inactivity threshold would flip every agent to Idle instantly and make the
 * Day 4 monitoring numbers meaningless, so these are correctness guards rather
 * than cosmetic validation.
 */
function validate(key: SettingKey, value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "value must be an object.";
  const v = value as Record<string, unknown>;

  if (key === "monitoring.config") {
    const mins = v.inactivityMinutes;
    if (typeof mins !== "number" || mins < 1 || mins > 120) {
      return "inactivityMinutes must be between 1 and 120.";
    }
    const beat = v.heartbeatSeconds;
    if (typeof beat !== "number" || beat < 5 || beat > 300) {
      return "heartbeatSeconds must be between 5 and 300.";
    }
    if (typeof mins === "number" && typeof beat === "number" && beat > mins * 60) {
      return "heartbeatSeconds cannot exceed the inactivity window, or idle could never be detected.";
    }
  }

  if (key === "shift.config") {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof v.startTime !== "string" || !time.test(v.startTime)) {
      return "startTime must be HH:MM (24-hour).";
    }
    if (typeof v.endTime !== "string" || !time.test(v.endTime)) {
      return "endTime must be HH:MM (24-hour).";
    }
    if (!Array.isArray(v.workingDays) || v.workingDays.some((d) => typeof d !== "number" || d < 0 || d > 6)) {
      return "workingDays must be an array of numbers 0-6 (0 = Sunday).";
    }
  }

  return null;
}
