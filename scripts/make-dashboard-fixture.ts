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
 *   npx tsx --env-file-if-exists=.env scripts/make-dashboard-fixture.ts
 */

import { PrismaClient, DispositionCode, LeadStatus } from "@prisma/client";
import { assignLeadsFromPool } from "../src/server/leads/assignment";

const prisma = new PrismaClient();

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
  return arr[Math.floor(Math.random() * arr.length)];
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

async function main() {
  console.log("Building dashboard fixture...");

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
        sourceLabel: pick(SOURCES),
        createdAt: hoursAgo(Math.random() * 72),
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
      quantity: 12 + Math.floor(Math.random() * 8),
      method: "MANUAL",
      actorId: management.id,
    });
    assignedTotal += result.leadIds.length;
  }
  console.log(`  assigned: ${assignedTotal} across ${agents.length} agents`);

  // --- calls + dispositions (stands in for Dev A's Day 5) ------------------
  const assigned = await prisma.lead.findMany({
    where: { status: LeadStatus.ASSIGNED, assignedToId: { not: null } },
    select: { id: true, assignedToId: true, phoneE164: true, currentAssignmentId: true },
  });

  let callCount = 0;
  let callbackCount = 0;

  for (const lead of assigned) {
    // Leave roughly a quarter untouched, so "assigned but not yet called" is
    // visible on the dashboard rather than everything looking worked.
    if (Math.random() < 0.25) continue;

    const code = pick(OUTCOME_MIX);
    const disp = dispByCode.get(code);
    const startedAt = hoursAgo(Math.random() * 8);
    const durationSec =
      code === DispositionCode.NO_ANSWER
        ? 5 + Math.floor(Math.random() * 25)
        : 45 + Math.floor(Math.random() * 400);

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
      const scheduledFor = new Date(Date.now() + (Math.random() * 96 - 24) * 3_600_000);
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

  const summary = await prisma.lead.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("\n  lead status spread:");
  for (const s of summary) console.log(`    ${s.status.padEnd(24)} ${s._count._all}`);
  console.log("\nFixture complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
