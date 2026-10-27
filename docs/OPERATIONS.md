# Operations: backups, load, scheduled jobs, hosting

How to keep the site running, and what was actually measured.

## Backups (and proving they restore)

`scripts/backup.sh` takes a full custom-format dump with `pg_dump`. With `--drill` it restores the
dump into a throwaway database and compares row counts table by table, then drops it:

```
DIRECT_URL=postgresql://... DRILL_ADMIN_URL=postgresql://admin@host/postgres ./scripts/backup.sh --drill
```

**A drill was run** against a copy of the browser-test database (`pg_dump -Fc`, `pg_restore` into a
fresh database): every table's row count matched (User, Builder, Project, Plot, Lead, Subscription,
Invoice, Booking, Review, AuditLog, and the 11 migrations). It was small data; run the drill on your
real database before launch and after any big change, and keep a restore log.

- **Neon free tier** keeps a short point-in-time history (check the current window in your Neon
  console) and is not a backup you control. Take your own dump weekly at least, daily once real money
  or leads are flowing, and store it somewhere other than Render or Neon (an encrypted drive or a
  second cloud bucket). Dumps contain personal data and payment references: encrypt them and delete old ones.
- **Restoring for real:** create an empty database, `pg_restore --no-owner --dbname=<url> file.dump`,
  point `DATABASE_URL` and `DIRECT_URL` at it, run `npx prisma migrate deploy` (it should say nothing
  is pending), then check `/api/health/db`.
- Uploaded files live in Cloudinary, not the database: they are not in the dump. Cloudinary keeps
  them; back them up separately if they matter to you (documents especially).

## Scheduled jobs (cron-job.org or similar)

All are `GET` or `POST` to a URL with the header `Authorization: Bearer <CRON_SECRET>`.

| Job | URL | How often |
|---|---|---|
| Follow-up reminders | `/api/cron/reminders` | every 15 minutes, or hourly |
| Daily lead summary | `/api/cron/digest` | once a day, morning |
| Approval expiry | `/api/cron/approvals` | once a day |
| Plans: reminders and expiry | `/api/cron/billing` | once a day |
| Monthly performance email | `/api/cron/performance` | once a day (sends once a month per company) |
| Booking holds and reconciliation | `/api/cron/bookings` | every 5 minutes (only if booking is on) |

Every job is safe to run twice or at the same moment (claims are taken before anything is sent). A
job that throws answers 500 and says only "failed"; the detail is in the server log. Render's free
web service **sleeps after 15 minutes without traffic**: a cron call wakes it, but the first request
is slow, and a five-minute booking job will keep it awake.

## What was measured

`scripts/load-test.mjs` (30 simultaneous visitors for 10 seconds per page, against a production build
on a developer machine, Postgres in Docker, a handful of rows):

| Page | Requests/s | p50 | p95 |
|---|---|---|---|
| `/api/health` | 265 | 111 ms | 134 ms |
| `/builder/alpha` (cached) | 183 | 159 ms | 209 ms |
| `/project/alpha-one` (cached) | 146 | 199 ms | 258 ms |
| `/` (cached) | 123 | 235 ms | 315 ms |
| `/projects` (search, built per visit) | 25 | 1,274 ms | 1,476 ms |

No request failed. A single visitor gets a search page in about 45 to 100 ms and a cached page in
about 10 ms; the table is for 30 people arriving at the same moment on one Node process.

The search page is the one to watch. It is built fresh for every visit (it depends on the filters in
the address), and it costs roughly 40 ms of server time, so one process serves about 25 of them a
second. I removed a duplicate database question per visit (`lib/search/cached.ts`); that did not change
the numbers, so the cost is mostly rendering, not the database. These figures are **not predictions
for Render's free tier**, which has a fraction of this machine's CPU: expect several times fewer
searches a second there. If search traffic grows, the cheapest fixes are caching the unfiltered
`/projects` page for a minute or two, then a paid instance. Run the same script against a staging
copy on Render before you rely on any number here. Heavy public pages other than search are cached
for 2 to 5 minutes and refreshed when a builder changes something.

## Moving off the free tier

When there is real traffic or money, the order of upgrades that matters most:

1. **Render web service: a paid instance** (always on, more CPU and memory). Removes the cold start
   and the 15-minute sleep, and lets the in-memory rate limits and the cron wake-ups behave.
2. **Neon: a paid plan** for a longer restore window and more connections. Keep the pooled URL for
   the app (`DATABASE_URL`) and the direct URL only for migrations (`DIRECT_URL`).
3. **Resend: a verified sending domain** (the shared sandbox sender only reaches your own address),
   with `MAIL_FROM` set to it, SPF and DKIM done.
4. **Cloudinary:** check the free storage and bandwidth against real photo volumes.
5. **A custom domain** and its `APP_BASE_URL`, then update the Auth0 callback and logout URLs.
6. **Error and uptime monitoring** (any service that pings `/api/health` and `/api/health/db` and
   emails you).

## Deploy checklist

1. `npm audit`, `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` set.
2. Take a backup (above). Apply migrations: `npx prisma migrate deploy` runs on deploy.
3. Environment variables set (see `.env.example`); `BILLING_DRIVER` and `BOOKING_ENABLED` empty
   unless their documents (`docs/BILLING.md`, `docs/BOOKING.md`) are satisfied.
4. Deploy, then check `/api/health`, `/api/health/db`, log in, open a project page.
5. Confirm the cron jobs hit their URLs and answer 200.
