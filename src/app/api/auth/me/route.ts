import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";

// Returns the signed-in user, their role and their resolved permission keys.
// The client uses this to decide what to render; the server still enforces
// every action through requirePermission().
export const GET = requireAuth(async (_req, { user }) => {
  return NextResponse.json({ user });
});
