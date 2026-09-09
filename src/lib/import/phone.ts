import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * LM-05 — U.S. phone number FORMAT validation.
 *
 * SCOPE WARNING, from the SRS and .claude/CLAUDE.md: this checks only that the
 * number is *well-formed* for the North American Numbering Plan. It does NOT
 * and MUST NOT check whether the line is live, reachable, connected or owned by
 * anyone — that is explicitly out of scope. Nothing in this file may make a
 * network call.
 *
 * libphonenumber-js validates against the published NANP rules (area code and
 * exchange code cannot start with 0 or 1, correct length, no reserved ranges),
 * which is a far better format check than a hand-rolled regex and still
 * entirely offline.
 */

export type PhoneCheck =
  | { ok: true; e164: string; national: string; raw: string }
  | { ok: false; reason: "MISSING" | "INVALID_FORMAT"; raw: string };

/**
 * Excel hands us phone numbers in several shapes: a string, a number when the
 * column was formatted numerically (which silently drops a leading zero and any
 * formatting), or a rich-text object. Normalise to a string first.
 */
export function coercePhoneInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // A numeric cell cannot hold a leading "+", so this is a bare NANP number.
    return String(Math.trunc(value));
  }
  return String(value).trim();
}

export function checkUsPhone(value: unknown): PhoneCheck {
  const raw = coercePhoneInput(value);
  if (!raw) return { ok: false, reason: "MISSING", raw: "" };

  // Default region US so bare 10-digit numbers parse; an explicit +<country>
  // prefix in the sheet still wins.
  const parsed = parsePhoneNumberFromString(raw, "US");

  if (!parsed || !parsed.isValid()) {
    return { ok: false, reason: "INVALID_FORMAT", raw };
  }

  // A +44 number is well-formed but not a U.S. number; the SRS scopes this
  // system to U.S. calling, so treat it as a format failure rather than
  // importing something the dialer cannot use.
  if (parsed.country !== "US") {
    return { ok: false, reason: "INVALID_FORMAT", raw };
  }

  return {
    ok: true,
    e164: parsed.number,
    national: parsed.formatNational(),
    raw,
  };
}
