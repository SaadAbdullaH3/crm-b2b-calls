import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Small response/validation helpers shared by the API routes.
 *
 * Error shape matches what rbac.ts already returns ({ error, message }) so a
 * client can handle 400/401/403/404/409 uniformly.
 */

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: "INVALID_INPUT", message, details }, { status: 400 });
}

export function notFound(message = "Not found.") {
  return NextResponse.json({ error: "NOT_FOUND", message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: "CONFLICT", message }, { status: 409 });
}

/**
 * Parses and validates a JSON body (NF-04: server-side validation is the only
 * validation that counts). Returns a discriminated union so the caller can
 * return `res` directly on failure.
 */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ success: true; data: T } | { success: false; res: NextResponse }> {
  const raw = await req.json().catch(() => null);
  if (raw === null) {
    return { success: false, res: badRequest("Request body must be valid JSON.") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return { success: false, res: badRequest("Validation failed.", details) };
  }

  return { success: true, data: parsed.data };
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
  );
}
