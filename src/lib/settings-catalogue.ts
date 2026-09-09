/**
 * System settings CATALOGUE — pure data, no imports.
 *
 * Split from settings.ts for the same reason session-core.ts is split from
 * session.ts: the seed script and the custom server need the key list and the
 * defaults without pulling in a PrismaClient. settings.ts adds the
 * database-backed accessors on top of this.
 *
 * Adding a setting means adding a key here — never a migration, because
 * `system_settings` is key/value + Json.
 */

export type SettingCategory = "dialer" | "monitoring" | "shift" | "notifications" | "reports";

export interface SettingDef<T = unknown> {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  default: T;
  /** Never returned through the API — write-only from the UI's perspective. */
  isSecret?: boolean;
}

// --- Shapes -----------------------------------------------------------------

export interface DialerConfig {
  /** Off until VC Dialer credentials are confirmed. The clipboard fallback is
   *  mandatory regardless of this flag (CL-03). */
  enabled: boolean;
  provider: string;
  baseUrl: string;
  clipboardFallback: boolean;
}

export interface DialerCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface MonitoringConfig {
  /** TM-03. Minutes of no qualifying activity before Active Time stops. */
  inactivityMinutes: number;
  /** Seconds between browser heartbeats. */
  heartbeatSeconds: number;
  /** TM-04. Total break minutes allowed per shift. */
  breakMinutesPerShift: number;
  /** TM-04. Longest single break before it is flagged. */
  maxSingleBreakMinutes: number;
}

export interface ShiftConfig {
  /** 24h "HH:MM", in `timeZone` below. */
  startTime: string;
  endTime: string;
  /** MG-07. Minutes after startTime before a login counts as late. */
  graceMinutes: number;
  /** 0 = Sunday. */
  workingDays: number[];
  /** NF-09. Timestamps are stored UTC and displayed in this zone. */
  timeZone: string;
}

// --- Registry ---------------------------------------------------------------

export const SETTINGS = {
  "dialer.config": {
    key: "dialer.config",
    category: "dialer",
    label: "VC Dialer connection",
    description: "Connection details for the VC Dialer service (AD-06).",
    default: {
      enabled: false,
      provider: "vcdialer",
      baseUrl: "",
      clipboardFallback: true,
    } as DialerConfig,
  } satisfies SettingDef<DialerConfig>,

  "dialer.credentials": {
    key: "dialer.credentials",
    category: "dialer",
    label: "VC Dialer credentials",
    description: "API credentials. Stored write-only — never returned by the API.",
    isSecret: true,
    default: { apiKey: "", apiSecret: "" } as DialerCredentials,
  } satisfies SettingDef<DialerCredentials>,

  "monitoring.config": {
    key: "monitoring.config",
    category: "monitoring",
    label: "Activity and break rules",
    description: "Idle threshold and break allowances (AD-07, TM-03, TM-04).",
    default: {
      inactivityMinutes: 5,
      heartbeatSeconds: 30,
      breakMinutesPerShift: 60,
      maxSingleBreakMinutes: 30,
    } as MonitoringConfig,
  } satisfies SettingDef<MonitoringConfig>,

  "shift.config": {
    key: "shift.config",
    category: "shift",
    label: "Working shift",
    description: "Shift window, lateness grace period and business time zone.",
    default: {
      startTime: "09:00",
      endTime: "18:00",
      graceMinutes: 10,
      workingDays: [1, 2, 3, 4, 5],
      timeZone: "UTC",
    } as ShiftConfig,
  } satisfies SettingDef<ShiftConfig>,
} as const;

export type SettingKey = keyof typeof SETTINGS;

/** Every key an Admin may write. Anything else is rejected by the settings API. */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSecretSetting(key: string): boolean {
  return Boolean((SETTINGS as Record<string, SettingDef>)[key]?.isSecret);
}
