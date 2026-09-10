import { getSetting } from "@/lib/settings";

/**
 * CL-02 / CL-03 — how a call gets placed.
 *
 * THE MANDATORY RULE: the clipboard fallback is not a stub and not a
 * degradation. The SRS requires it to work regardless of whether the VC Dialer
 * is available, so this resolver returns CLIPBOARD for every case that is not
 * a fully configured dialer — including the case where an Admin has switched
 * `clipboardFallback` off. There is deliberately no path that leaves an agent
 * with no way to place a call: a lead they cannot dial is a lead nobody calls.
 *
 * Reads `dialer.config` rather than assuming, per the house rule that made
 * TM-03's threshold configurable. As of Day 5 the VC Dialer API is still
 * unconfirmed and `enabled` defaults to false, so CLIPBOARD is the live path.
 */

export type DialerMode = "DIALER" | "CLIPBOARD";

export interface DialerHandoff {
  mode: DialerMode;
  /** E.164, what the agent actually dials or copies. */
  phone: string;
  /** Human-readable form, for the confirmation toast. */
  display: string;
  /** Only set when mode === "DIALER" — the URL the browser hands off to. */
  dialUrl?: string;
  /** Why clipboard was chosen, so the UI can say something useful. */
  reason?: string;
}

/** `tel:` is a last resort, not the dialer integration — see resolveDialerHandoff. */
function telUrl(phoneE164: string): string {
  return `tel:${phoneE164}`;
}

export async function resolveDialerHandoff(args: {
  phoneE164: string;
  display?: string | null;
}): Promise<DialerHandoff> {
  const config = await getSetting("dialer.config");
  const phone = args.phoneE164;
  const display = args.display?.trim() || phone;

  if (!config.enabled) {
    return {
      mode: "CLIPBOARD",
      phone,
      display,
      reason: "The VC Dialer is not enabled in Admin settings.",
    };
  }

  if (!config.baseUrl?.trim()) {
    // Enabled but unconfigured is the dangerous middle state: without this the
    // agent would get a handoff to nowhere and no number on their clipboard.
    return {
      mode: "CLIPBOARD",
      phone,
      display,
      reason: "The VC Dialer is enabled but has no base URL configured.",
    };
  }

  const base = config.baseUrl.replace(/\/+$/, "");
  return {
    mode: "DIALER",
    phone,
    display,
    // Shape is provider-specific and gets replaced on Day 9 against the real
    // API. Kept here rather than in the route so there is one place to change.
    dialUrl: `${base}/dial?number=${encodeURIComponent(phone)}`,
  };
}

export { telUrl };
