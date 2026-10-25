# RKB Platform

A subscription-based digital showroom where builders list projects, receive verified buyer leads and take plot bookings online. Built with Next.js, Prisma and Postgres; hosted on Render with Auth0 for login.

- Plan: [docs/PLAN.md](docs/PLAN.md) (product scope, screens, data model)
- Phases: [docs/PHASES.md](docs/PHASES.md) (stack and delivery order)
- Phase 0 setup checklist: [docs/SETUP-PHASE-0.md](docs/SETUP-PHASE-0.md)

## Local development

Requires Node 22 or newer.

```bash
npm install            # also runs `prisma generate`
cp .env.example .env   # then fill in DATABASE_URL and DIRECT_URL (Neon)
npm run db:migrate     # apply migrations to your database
npm run dev            # http://localhost:3000
```

## Scripts

| Script                                  | What it does                        |
| --------------------------------------- | ----------------------------------- |
| `npm run dev`                           | Dev server                          |
| `npm run build` / `npm start`           | Production build and server         |
| `npm run lint` / `typecheck` / `test`   | Quality checks (also run in CI)     |
| `npm run format`                        | Prettier                            |
| `npm run db:migrate` / `db:migrate:dev` | Apply migrations / create a new one |

## Health checks

- `GET /api/health`: liveness, no database. Used by Render and the uptime pinger.
- `GET /api/health/db`: readiness, runs `SELECT 1` against Postgres.

## Free-tier rules (Render)

One web service only (750 free hours per month). No local file storage (the disk is wiped on restart): files go to Cloudinary. No background workers: scheduled work runs through `/api/cron/*` endpoints. The free service sleeps after 15 minutes idle, so it is for development and pilots, not paying customers. See PHASES.md section 1.
