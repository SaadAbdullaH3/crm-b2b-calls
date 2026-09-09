/**
 * Database-backed accessors for system settings (AD-06 through AD-09).
 *
 * The catalogue — keys, defaults, shapes — lives in settings-catalogue.ts,
 * which imports nothing. Import from there in the seed script or anywhere a
 * PrismaClient must not be created; import from here to actually read or write
 * a value.
 *
 * DEV A / DEV B CONTRACT: the Monitoring Engine (Day 4) reads its threshold via
 * getInactivityMs() rather than hard-coding TM-03's 5 minutes, because AD-07
 * makes it Admin-configurable. Anything else needing a tunable number should
 * add a key to the catalogue, not a constant.
 *
 * Safe to import from the custom server (cron, sockets): no `server-only`, no
 * `next/*`. See session-core.ts for why that matters.
 */

import { prisma } from "@/lib/db";
import { SETTINGS, isSecretSetting, type SettingKey } from "@/lib/settings-catalogue";

export * from "@/lib/settings-catalogue";

type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

/**
 * Reads one setting, falling back to its catalogue default when the row is
 * missing. Shallow-merges over the default so a setting can gain new sub-keys
 * without a data migration.
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const fallback = SETTINGS[key].default;

  if (!row) return fallback as SettingValue<K>;

  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return { ...(fallback as object), ...(row.value as object) } as SettingValue<K>;
  }
  return row.value as unknown as SettingValue<K>;
}

/** Convenience for the value read on every monitoring tick (TM-03). */
export async function getInactivityMs(): Promise<number> {
  const cfg = await getSetting("monitoring.config");
  return cfg.inactivityMinutes * 60_000;
}

/**
 * LA-05. How long a lead request waits for Management before the server-side
 * job assigns it automatically. Read this rather than hard-coding 5 minutes —
 * the Day 4 auto-assign sweep and the agent's countdown must agree, and an
 * Admin can change it.
 */
export async function getAutoAssignMs(): Promise<number> {
  const cfg = await getSetting("assignment.config");
  return cfg.autoAssignMinutes * 60_000;
}

/** Upsert a setting. `updatedById` is recorded for the audit trail. */
export async function setSetting(
  key: SettingKey,
  value: unknown,
  updatedById: string | null,
): Promise<void> {
  const def = SETTINGS[key];
  await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      category: def.category,
      value: value as object,
      isSecret: isSecretSetting(key),
      description: def.description,
      updatedById,
    },
    update: { value: value as object, updatedById },
  });
}
