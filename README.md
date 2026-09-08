# CRM — B2B Calls

Web-based CRM for a B2B call center. Two-developer build; see `docs/crm-b2b-build-plan.md`
for the full spec and the 10-day plan, and `GLOBAL.md` for current status.

## Requirements

- Node.js 20+ (built on 25.x)
- Docker (for local Postgres)

## Setup

```bash
cp .env.example .env      # then edit SESSION_SECRET
docker compose up -d      # Postgres 16 on :5432
npm install
npx prisma migrate dev    # applies the schema
npm run db:seed           # roles, permissions, dispositions, 8 dev users
npm run dev               # http://localhost:3000
```

> **Pin Prisma to 6.19.3.** `npm install prisma` resolves to 7.x ("Prisma Next"),
> which uses a completely different migration workflow. Do not upgrade mid-sprint.

## Dev accounts

All use the password in `SEED_PASSWORD` (default `ChangeMe123!`).

| Email | Role |
|---|---|
| `agent1@crm.local` … `agent5@crm.local` | Agent |
| `management@crm.local` | Management |
| `admin@crm.local` | Admin |
| `hr@crm.local` | HR |

## Architecture notes

- **Custom server** (`server.ts`, run through `tsx`) — *not* `next start`. One process owns
  the Next handler, Socket.io, and the `node-cron` jobs. This is why deployment targets a
  VPS behind Nginx with PM2/Docker rather than Vercel.
- **Lead locking** — current owner is denormalized onto `leads`; `lead_assignments` is
  append-only history. A partial unique index (`lead_assignments_one_active_holder`) makes
  double-assignment impossible at the database level. See the Day 1 entry in
  `.claude/CLAUDE.md` for the required assignment-transaction recipe.
- **Cron jobs are jobs, not requests.** The 5-minute auto-assign and idle sweeps run
  server-side and must survive an agent closing their browser. `ENABLE_CRON` must be true
  on exactly one process.
- **RBAC is enforced once**, at the API-route level, via `requireRole()` / `requirePermission()`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Custom server, development |
| `npm start` | Custom server, production |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` / `db:down` | Start/stop Postgres |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed roles, permissions, dispositions, users |
| `npm run db:studio` | Prisma Studio |
