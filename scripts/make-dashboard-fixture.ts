/**
 * Dev fixture for the Management Dashboard (Dev B, Day 6).
 *
 * Produces a realistic operational picture: leads across several sources,
 * assigned to agents, called with a spread of dispositions, plus callbacks and
 * a pending lead request.
 *
 * Assignment goes through Dev A's `assignLeadsFromPool` rather than writing
 * `leads` and `lead_assignments` directly. That matters: his transaction owns
 * the ownership columns and the partial unique index, and a fixture that
 * bypassed it would produce data the real application could never create — so
 * the dashboard would be verified against a fiction.
 *
 * Calls and dispositions ARE written directly, because the code that will
 * write them for real is Dev A's Day 5 disposition modal, which does not exist
 * yet. Those rows are the one part of this fixture that is standing in for
 * absent code rather than exercising present code.
 *
 * DETERMINISTIC and IDEMPOTENT, both deliberately:
 *
 *   * Every random choice comes from a seeded generator, so the same command
 *     produces the same 120 leads, 55 calls and 13 callbacks every time. A
 *     fixture whose totals move between runs cannot be used to verify a
 *     dashboard — you would never know whether a changed number meant a
 *     regression or just a different dice roll.
 *   * Every row it creates is tagged, and a re-run deletes the previous
 *     fixture first. Without that, running it twice silently doubles the
 *     database and every figure verified against it becomes meaningless.
 *
 * It never touches non-fixture data, so it is safe against a database that
 * also holds real imports.
 *
 *   npx tsx --env-file-if-exists=.env scripts/make-dashboard-fixture.ts
 */

import { PrismaClient, DispositionCode, LeadStatus } from "@prisma/client";
import { assignLeadsFromPool } from "../src/server/leads/assignment";

const prisma = new PrismaClient();

/** Marks every lead this script creates, so a re-run can find and remove them. */
const FIXTURE_TAG = "[fixture]";

/**
 * Seeded PRNG (mulberry32). `Math.random()` would make the documented totals a
 * lie the moment anyone re-ran this.
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260910);

const SOURCES = ["LinkedIn Q3", "Trade Show 2026", "Cold List A", "Website Inbound"];

const COMPANIES = [
  "Acme Logistics", "Globex Manufacturing", "Initech Systems", "Umbrella Health",
  "Soylent Foods", "Stark Industrial", "Wayne Freight", "Cyberdyne Robotics",
  "Massive Dynamic", "Tyrell Analytics", "Wonka Confectionery", "Duff Beverages",
  "Vandelay Imports", "Bluth Property", "Pied Piper Data", "Hooli Cloud",
];

const FIRST = ["James", "Maria", "Chen", "Aisha", "Tom", "Priya", "Luis", "Anna"];
const LAST = ["Reed", "Santos", "Wei", "Khan", "Baker", "Nair", "Ortega", "Novak"];

/** Weighted so the mix looks like a real day: mostly no-answer. */
const OUTCOME_MIX: DispositionCode[] = [
  ...Array(9).fill(DispositionCode.NO_ANSWER),
  ...Array(4).fill(DispositionCode.CALL_BACK_LATER),
  ...Array(3).fill(DispositionCode.NOT_INTERESTED),
  ...Array(2).fill(DispositionCode.QUALIFIED),
  DispositionCode.EMAIL,
  DispositionCode.DO_NOT_CALL,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

/**
 * Removes the previous run. Order matters: callbacks and calls reference
 * leads, and `lead_assignments` rows must go before the leads they point at.
 * Deleting through Prisma rather than raw SQL keeps the cascade rules honest.
 */
async function resetPreviousFixture(): Promise<void> {
  const prior = await prisma.lead.findMany({
    where: { sourceLabel: { contains: FIXTURE_TAG } },
    select: { id: true },
  });
  if (prior.length === 0) return;

  const ids = prior.map((l) => l.id);

  await prisma.callback.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.call.deleteMany({ where: { leadId: { in: ids } } });
  // Clear the ownership pointer before removing the assignment rows it
  // references, or the FK on current_assignment_id blocks the delete.
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { currentAssignmentId: null, assignedToId: null, lockedAt: null },
  });
  await prisma.leadAssignment.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });

  console.log(`  removed ${ids.length} lead(s) from a previous fixture run`);
}

async function main() {
  console.log("Building dashboard fixture...");
  await resetPreviousFixture();

  const agents = await prisma.user.findMany({
    where: { role: { name: "agent" }, isActive: true },
    select: { id: true, fullName: true },
    orderBy: { email: "asc" },
  });
  if (agents.length === 0) throw new Error("No agents. Run `npm run db:seed` first.");

  const management = await prisma.user.findFirstOrThrow({
    where: { role: { name: "management" } },
    select: { id: true },
  });

  const dispositions = await prisma.disposition.findMany();
  const dispByCode = new Map(dispositions.map((d) => [d.code, d]));

  // --- leads --------------------------------------------------------------
  let created = 0;
  for (let i = 0; i < 120; i++) {
    const company = `${pick(COMPANIES)} ${i}`;
    await prisma.lead.create({
      data: {
        companyName: company,
        contactName: `${pick(FIRST)} ${pick(LAST)}`,
        jobTitle: pick(["Operations Manager", "Owner", "Head of Logistics", "Director"]),
        phoneRaw: `(415) 555-${String(1000 + i).slice(-4)}`,
        phoneE164: `+1415555${String(1000 + i).slice(-4)}`,
        email: `contact${i}@${company.split(" ")[0].toLowerCase()}.com`,
        city: pick(["San Francisco", "Austin", "Chicago", "Denver", "Boston"]),
        state: pick(["CA", "TX", "IL", "CO", "MA"]),
        sourceLabel: `${pick(SOURCES)} ${FIXTURE_TAG}`,
        createdAt: hoursAgo(rng() * 72),
      },
    });
    created++;
  }
  console.log(`  leads: ${created}`);

  // --- assignment, through Dev A's real transaction ------------------------
  let assignedTotal = 0;
  for (const agent of agents) {
    const result = await assignLeadsFromPool({
      agentId: agent.id,
      quantity: 12 + Math.floor(rng() * 8),
      method: "MANUAL",
      actorId: management.id,
    });
    assignedTotal += result.leadIds.length;
  }
  console.log(`  assigned: ${assignedTotal} across ${agents.length} agents`);

  // --- calls + dispositions (stands in for Dev A's Day 5) ------------------
  // Scoped to fixture leads. Without the tag this would also dial any real
  // imported lead that happened to be assigned — the fixture must never write
  // calls against data it did not create.
  const assigned = await prisma.lead.findMany({
    where: {
      status: LeadStatus.ASSIGNED,
      assignedToId: { not: null },
      sourceLabel: { contains: FIXTURE_TAG },
    },
    orderBy: { id: "asc" },
    select: { id: true, assignedToId: true, phoneE164: true, currentAssignmentId: true },
  });

  let callCount = 0;
  let callbackCount = 0;

  for (const lead of assigned) {
    // Leave roughly a quarter untouched, so "assigned but not yet called" is
    // visible on the dashboard rather than everything looking worked.
    if (rng() < 0.25) continue;

    const code = pick(OUTCOME_MIX);
    const disp = dispByCode.get(code);
    const startedAt = hoursAgo(rng() * 8);
    const durationSec =
      code === DispositionCode.NO_ANSWER
        ? 5 + Math.floor(rng() * 25)
        : 45 + Math.floor(rng() * 400);

    const call = await prisma.call.create({
      data: {
        leadId: lead.id,
        agentId: lead.assignedToId!,
        assignmentId: lead.currentAssignmentId,
        dispositionId: disp?.id ?? null,
        startedAt,
        endedAt: new Date(startedAt.getTime() + durationSec * 1000),
        durationSec,
        phoneDialed: lead.phoneE164,
        channel: "CLIPBOARD",
        notes: code === DispositionCode.QUALIFIED ? "Interested, sending pricing." : null,
        createdAt: startedAt,
      },
    });
    callCount++;

    const nextStatus =
      code === DispositionCode.QUALIFIED
        ? LeadStatus.CLOSED_QUALIFIED
        : code === DispositionCode.NOT_INTERESTED
          ? LeadStatus.CLOSED_NOT_INTERESTED
          : code === DispositionCode.DO_NOT_CALL
            ? LeadStatus.DO_NOT_CALL
            : code === DispositionCode.CALL_BACK_LATER
              ? LeadStatus.CALLBACK_SCHEDULED
              : LeadStatus.ASSIGNED;

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastDispositionCode: code,
        lastDispositionAt: startedAt,
        callAttempts: { increment: 1 },
        status: nextStatus,
        ...(code === DispositionCode.DO_NOT_CALL
          ? { doNotCall: true, doNotCallAt: startedAt, doNotCallById: lead.assignedToId }
          : {}),
      },
    });

    if (code === DispositionCode.CALL_BACK_LATER) {
      const scheduledFor = new Date(Date.now() + (rng() * 96 - 24) * 3_600_000);
      await prisma.callback.create({
        data: {
          leadId: lead.id,
          agentId: lead.assignedToId!,
          callId: call.id,
          scheduledFor,
          status: "SCHEDULED",
        },
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { nextCallbackAt: scheduledFor },
      });
      callbackCount++;
    }
  }
  console.log(`  calls: ${callCount}, callbacks: ${callbackCount}`);

  // --- a pending request, so the approval queue has something in it --------
  const existingPending = await prisma.leadRequest.count({ where: { status: "PENDING" } });
  if (existingPending === 0) {
    const cfgAgent = agents[0];
    await prisma.leadRequest.create({
      data: {
        agentId: cfgAgent.id,
        quantityRequested: 15,
        quantitySource: "PRESET_15",
        status: "PENDING",
        autoAssignAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    console.log(`  pending lead request: 1 (${cfgAgent.fullName}, 15 leads)`);
  }

  const summary = await prisma.lead.groupBy({
    by: ["status"],
    where: { sourceLabel: { contains: FIXTURE_TAG } },
    _count: { _all: true },
  });
  console.log("\n  lead status spread:");
  for (const s of summary) console.log(`    ${s.status.padEnd(24)} ${s._count._all}`);

  // The seed is fixed, so these are constants rather than expectations. If they
  // drift, either the seed moved or assignment behaviour changed — both are
  // worth hearing about loudly, rather than discovering later through a
  // dashboard figure that quietly stopped matching its documentation.
  const EXPECTED = { leads: 120, assigned: 78, calls: 56, callbacks: 12 };
  const actual = {
    leads: created,
    assigned: assignedTotal,
    calls: callCount,
    callbacks: callbackCount,
  };

  const drift = (Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]).filter(
    (k) => EXPECTED[k] !== actual[k],
  );

  if (drift.length > 0) {
    console.warn(
      `\n  ! FIXTURE DRIFT — ${drift
        .map((k) => `${k}: expected ${EXPECTED[k]}, got ${actual[k]}`)
        .join("; ")}`,
    );
    console.warn(
      "    The seed is fixed, so this means the generator or the assignment",
    );
    console.warn(
      "    logic changed. Update EXPECTED here and the totals in DEV-B.md.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `\n  totals match the documented fixture (${EXPECTED.leads} leads, ${EXPECTED.calls} calls, ${EXPECTED.callbacks} callbacks)`,
    );
  }

  console.log("\nFixture complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
