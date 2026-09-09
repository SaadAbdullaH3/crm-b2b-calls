import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { EVENTS, emitToUser } from "@/server/socket";
import { returnUncalledLeadsIfSignedOut } from "@/server/leads/assignment";

export async function POST() {
  const ended = await destroySession();

  if (ended) {
    // LA-09 / LA-10 — uncalled leads go back to the pool the moment the agent
    // signs out. Leads carrying any disposition stay with them.
    //
    // "IfSignedOut" because an agent signed in on two machines who closes one
    // has not really left; the check is for a remaining live session, not for
    // this particular one ending.
    //
    // Deliberately awaited, not fired and forgotten: an agent who signs out and
    // straight back in must not race their own lead return and end up with the
    // leads re-assigned mid-release.
    let releasedCount = 0;
    try {
      const released = await returnUncalledLeadsIfSignedOut(ended.userId);
      releasedCount = released.length;
    } catch (e) {
      // Never block the logout itself. The expired-session sweep in cron will
      // pick these up within the minute.
      console.error("[logout] lead return failed", ended.userId, e);
    }

    // Dev B's monitoring engine stops screen time on this event.
    emitToUser(ended.userId, EVENTS.SESSION_ENDED, {
      userId: ended.userId,
      sessionId: ended.sessionId,
      at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, leadsReturned: releasedCount });
  }

  return NextResponse.json({ ok: true, leadsReturned: 0 });
}
