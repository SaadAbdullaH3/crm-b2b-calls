import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { EVENTS, emitToUser } from "@/server/socket";

export async function POST() {
  const ended = await destroySession();

  if (ended) {
    // Day 4 (LA-09): this is where uncalled leads return to the pool. Leads
    // carrying an active follow-up disposition stay with the agent (LA-10).
    // Dev B's monitoring engine also stops screen time on this event.
    emitToUser(ended.userId, EVENTS.SESSION_ENDED, {
      userId: ended.userId,
      sessionId: ended.sessionId,
      at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: true });
}
