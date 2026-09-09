/**
 * NF-07 proof: two agents can never end up owning the same lead.
 *
 *   npx tsx --env-file-if-exists=.env scripts/assignment-concurrency-test.ts
 *
 * Deliberately oversubscribes the pool: several agents each ask for more leads
 * than exist, all at the same instant. The interesting assertion is not
 * "everyone got leads" — it is that the pool is handed out exactly once, with
 * no lead appearing twice and no lead left half-assigned.
 *
 * ISOLATION: the assignment primitive claims from the WHOLE available pool, not
 * just this script's rows, so the test snapshots every available lead before it
 * runs and asserts against that snapshot. An earlier version asserted against
 * its own tagged rows and reported false failures whenever the database already
 * held other available leads — the product was fine, the harness was lying.
 * Any pre-existing lead this test claims is released again during cleanup.
 *
 * Run after ANY change to src/server/leads/assignment.ts. Fast, uses the real
 * database, cleans up after itself.
 */

import { AssignmentMethod, LeadStatus, PrismaClient, ReleaseReason } from "@prisma/client";
import { assignLeadsFromPool } from "../src/server/leads/assignment";

const prisma = new PrismaClient();

const EXTRA_LEADS = 20;
const AGENTS = 5;
const EACH_REQUESTS = 10;
const TAG = "__concurrency_test__";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Puts borrowed leads back and deletes the ones this script created. */
async function cleanup(borrowedIds: string[] = []) {
  if (borrowedIds.length > 0) {
    await prisma.leadAssignment.updateMany({
      where: { leadId: { in: borrowedIds }, releasedAt: null },
      data: { releasedAt: new Date(), releaseReason: ReleaseReason.ADMIN_OVERRIDE },
    });
    await prisma.lead.updateMany({
      where: { id: { in: borrowedIds } },
      data: {
        status: LeadStatus.AVAILABLE,
        assignedToId: null,
        lockedAt: null,
        currentAssignmentId: null,
      },
    });
  }

  const own = await prisma.lead.findMany({
    where: { sourceLabel: TAG },
    select: { id: true },
  });
  const ids = own.map((l) => l.id);
  if (ids.length === 0) return;

  // current_assignment_id references lead_assignments, so break the pointer
  // before deleting the history rows.
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { currentAssignmentId: null },
  });
  await prisma.leadAssignment.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await cleanup();

  const agents = await prisma.user.findMany({
    where: { role: { name: "agent" }, isActive: true },
    take: AGENTS,
    select: { id: true, fullName: true },
  });
  if (agents.length < AGENTS) {
    throw new Error(`Need ${AGENTS} agents seeded; found ${agents.length}. Run npm run db:seed.`);
  }

  await prisma.lead.createMany({
    data: Array.from({ length: EXTRA_LEADS }, (_, i) => ({
      companyName: `Concurrency Co ${i + 1}`,
      contactName: `Tester ${i + 1}`,
      phoneE164: `+1415555${String(1000 + i).padStart(4, "0")}`,
      sourceLabel: TAG,
      status: LeadStatus.AVAILABLE,
    })),
  });

  // The real pool the agents will race for: this script's rows plus whatever
  // else happens to be available in this database.
  const before = await prisma.lead.findMany({
    where: { status: LeadStatus.AVAILABLE, assignedToId: null, doNotCall: false },
    select: { id: true },
  });
  const poolIds = new Set(before.map((l) => l.id));
  const demand = AGENTS * EACH_REQUESTS;
  const expected = Math.min(poolIds.size, demand);

  console.log("\nNF-07 concurrent assignment test");
  console.log(`  pool: ${poolIds.size} available | demand: ${AGENTS} agents x ${EACH_REQUESTS} = ${demand}`);
  console.log(`  expecting exactly ${expected} handed out\n`);

  // The whole point: no staggering, no awaiting between calls.
  const results = await Promise.all(
    agents.map((a) =>
      assignLeadsFromPool({
        agentId: a.id,
        quantity: EACH_REQUESTS,
        method: AssignmentMethod.MANUAL,
        actorId: null,
      }).catch((e) => {
        console.log(`  (agent ${a.fullName} threw: ${e instanceof Error ? e.message : e})`);
        return { leadIds: [] as string[], requested: EACH_REQUESTS, assigned: 0 };
      }),
    ),
  );

  const handedOut = results.flatMap((r) => r.leadIds);
  const unique = new Set(handedOut);

  console.log("Results");
  results.forEach((r, i) => console.log(`  ${agents[i]!.fullName}: ${r.assigned}`));
  console.log(`  total handed out: ${handedOut.length}\n`);

  console.log("Assertions");

  // THE invariant. Everything else is a consistency check around it.
  check(
    "no lead handed to two agents",
    unique.size === handedOut.length,
    `${handedOut.length - unique.size} duplicate(s)`,
  );

  check(
    "every lead handed out came from the available pool",
    handedOut.every((id) => poolIds.has(id)),
    "a lead was assigned that was not available beforehand",
  );

  check(
    "handed out exactly what the pool could satisfy",
    handedOut.length === expected,
    `${handedOut.length} vs expected ${expected}`,
  );

  const assignedInDb = await prisma.lead.count({
    where: { id: { in: handedOut }, assignedToId: { not: null } },
  });
  check(
    "database agrees every handed-out lead is owned",
    assignedInDb === handedOut.length,
    `db=${assignedInDb} returned=${handedOut.length}`,
  );

  const openPerLead = await prisma.$queryRaw<{ lead_id: string; n: bigint }[]>`
    SELECT lead_id, count(*) AS n
    FROM lead_assignments
    WHERE lead_id = ANY(${handedOut}) AND released_at IS NULL
    GROUP BY lead_id
    HAVING count(*) > 1
  `;
  check(
    "no lead has two open assignment rows",
    openPerLead.length === 0,
    `${openPerLead.length} lead(s) with multiple open rows`,
  );

  const mismatched = await prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id
    FROM leads l
    JOIN lead_assignments a ON a.id = l.current_assignment_id
    WHERE l.id = ANY(${handedOut})
      AND (a.assigned_to_id <> l.assigned_to_id OR a.released_at IS NOT NULL)
  `;
  check(
    "current_assignment_id agrees with assigned_to_id",
    mismatched.length === 0,
    `${mismatched.length} lead(s) out of step`,
  );

  const orphaned = await prisma.lead.count({
    where: { id: { in: handedOut }, currentAssignmentId: null },
  });
  check("no assigned lead is missing its assignment pointer", orphaned === 0, `${orphaned} orphaned`);

  const stillAvailable = await prisma.lead.count({
    where: { id: { in: handedOut }, status: LeadStatus.AVAILABLE },
  });
  check("no lead is both AVAILABLE and owned", stillAvailable === 0, `${stillAvailable} found`);

  // Leads that already existed before this script ran must go back as they
  // were; only the rows this script created get deleted.
  const ownIds = new Set(
    (await prisma.lead.findMany({ where: { sourceLabel: TAG }, select: { id: true } })).map(
      (l) => l.id,
    ),
  );
  const borrowed = handedOut.filter((id) => !ownIds.has(id));
  await cleanup(borrowed);

  console.log(
    failures === 0 ? "\nAll assertions passed.\n" : `\n${failures} assertion(s) FAILED.\n`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
