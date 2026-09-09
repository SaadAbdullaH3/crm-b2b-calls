/**
 * Seed: roles, the permission matrix, the 6 system dispositions, and the 8
 * initial users (5 Agent, 1 Management, 1 Admin, 1 HR).
 *
 * Idempotent — every write is an upsert, so re-running never duplicates.
 *
 * These are DEVELOPMENT credentials. The real 8 accounts are created on Day 10
 * during deployment; do not ship SEED_PASSWORD to production.
 *
 *   npm run db:seed
 */

import { PrismaClient, DispositionCode, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS, ROLES } from "../src/lib/auth/permissions";
import { SETTINGS, SETTING_KEYS, isSecretSetting } from "../src/lib/settings-catalogue";

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "ChangeMe123!";

/** The 6 outcomes required by the SRS calling workflow (CL-05). */
const DISPOSITIONS = [
  {
    code: DispositionCode.NO_ANSWER,
    label: "No Answer",
    description: "Nobody picked up. The lead stays callable.",
    isFollowUp: false,
    requiresCallback: false,
    blocksCalling: false,
    sortOrder: 1,
  },
  {
    code: DispositionCode.CALL_BACK_LATER,
    label: "Call Back Later",
    description: "Prospect asked to be called back. Requires a date and time.",
    isFollowUp: true,
    requiresCallback: true,
    blocksCalling: false,
    sortOrder: 2,
  },
  {
    code: DispositionCode.NOT_INTERESTED,
    label: "Not Interested",
    description: "Prospect declined. Closed, but not blocked.",
    isFollowUp: false,
    requiresCallback: false,
    blocksCalling: false,
    sortOrder: 3,
  },
  {
    code: DispositionCode.DO_NOT_CALL,
    label: "Do Not Call",
    description:
      "Prospect must not be contacted again. Blocks normal calling and reassignment until an Admin/Management override.",
    isFollowUp: true,
    requiresCallback: false,
    blocksCalling: true,
    sortOrder: 4,
  },
  {
    code: DispositionCode.EMAIL,
    label: "Email",
    description: "Follow-up moved to email. Stays with the agent.",
    isFollowUp: true,
    requiresCallback: false,
    blocksCalling: false,
    sortOrder: 5,
  },
  {
    code: DispositionCode.QUALIFIED,
    label: "Successful — Qualify",
    description: "Lead qualified successfully.",
    isFollowUp: true,
    requiresCallback: false,
    blocksCalling: false,
    sortOrder: 6,
  },
];

const USERS = [
  { email: "agent1@crm.local", fullName: "Agent One", role: "agent", employeeCode: "AG-001" },
  { email: "agent2@crm.local", fullName: "Agent Two", role: "agent", employeeCode: "AG-002" },
  { email: "agent3@crm.local", fullName: "Agent Three", role: "agent", employeeCode: "AG-003" },
  { email: "agent4@crm.local", fullName: "Agent Four", role: "agent", employeeCode: "AG-004" },
  { email: "agent5@crm.local", fullName: "Agent Five", role: "agent", employeeCode: "AG-005" },
  { email: "management@crm.local", fullName: "Management User", role: "management", employeeCode: "MG-001" },
  { email: "admin@crm.local", fullName: "Admin User", role: "admin", employeeCode: "AD-001" },
  { email: "hr@crm.local", fullName: "HR User", role: "hr", employeeCode: "HR-001" },
];

/** AD-03 / CM-05. The SRS names these four explicitly as examples. */
const GROUPS = [
  { name: "B2B Team", description: "All agents working the B2B calling campaign." },
  { name: "Senior Agents", description: "Experienced agents; larger lead batches." },
  { name: "New Agents", description: "Agents in onboarding." },
  { name: "Training Team", description: "Staff running training and quality review." },
];

async function main() {
  console.log("Seeding...");

  // --- permissions ---------------------------------------------------------
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: p,
    });
  }
  console.log(`  permissions: ${PERMISSIONS.length}`);

  // --- roles + role_permissions -------------------------------------------
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { label: r.label, description: r.description, isSystem: true },
      create: { name: r.name, label: r.label, description: r.description, isSystem: true },
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: r.permissions } },
      select: { id: true },
    });

    // Re-assert the baseline matrix: drop mappings that are no longer in the
    // catalogue, then add the current set.
    //
    // !! Since Day 2 this is destructive. AD-02 lets an Admin re-map
    // permissions at runtime, and `role_permissions` is authoritative once
    // they have. Re-running the seed RESETS those changes back to the baseline
    // in permissions.ts. Fine in development; on a live database, re-seed only
    // when you intend to discard the Admin's customisation.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });

    console.log(`  role ${r.name}: ${permissions.length} permissions`);
  }

  // --- dispositions --------------------------------------------------------
  for (const d of DISPOSITIONS) {
    await prisma.disposition.upsert({
      where: { code: d.code },
      update: { ...d, isSystem: true },
      create: { ...d, isSystem: true },
    });
  }
  console.log(`  dispositions: ${DISPOSITIONS.length}`);

  // --- users ---------------------------------------------------------------
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  for (const u of USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
    await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, roleId: role.id, isActive: true },
      create: {
        email: u.email,
        fullName: u.fullName,
        employeeCode: u.employeeCode,
        passwordHash,
        roleId: role.id,
      },
    });
  }
  console.log(`  users: ${USERS.length} (password: ${SEED_PASSWORD})`);

  // --- system settings (Dev B, Day 2 — AD-06/07/08/09) ---------------------
  // CREATE-ONLY, unlike the blocks above. These are operational values an
  // Admin tunes at runtime (the TM-03 idle threshold especially); overwriting
  // them on every re-seed would silently revert their configuration.
  let settingsCreated = 0;
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key];
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (existing) continue;

    await prisma.systemSetting.create({
      data: {
        key,
        category: def.category,
        // The catalogue defaults are typed interfaces; Prisma's Json input
        // wants an index signature, so widen here rather than polluting the
        // interfaces with `[k: string]: unknown`.
        value: def.default as unknown as Prisma.InputJsonValue,
        isSecret: isSecretSetting(key),
        description: def.description,
      },
    });
    settingsCreated++;
  }
  console.log(`  settings: ${settingsCreated} created, ${SETTING_KEYS.length - settingsCreated} already present`);

  // --- groups (AD-03; the CM-05 examples from the SRS) ---------------------
  for (const g of GROUPS) {
    await prisma.group.upsert({
      where: { name: g.name },
      update: { description: g.description, isSystem: true },
      create: { ...g, isSystem: true },
    });
  }
  console.log(`  groups: ${GROUPS.length}`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
