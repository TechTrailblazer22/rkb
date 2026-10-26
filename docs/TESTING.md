# Testing

## Everyday checks

```bash
npm run lint
npm run typecheck
npm test            # unit tests; database tests are skipped unless TEST_DATABASE_URL is set
```

CI runs these plus the database tests against a Postgres service (`.github/workflows/ci.yml`).

## Database tests

Run against a throwaway Postgres with the migrations applied:

```bash
docker run -d --name rkb-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rkb_test -p 54329:5432 postgres:17-alpine
DIRECT_URL=postgresql://postgres:test@localhost:54329/rkb_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/rkb_test npm test
docker rm -f rkb-test-pg
```

## Logged-in end-to-end check

Real Auth0 login needs a browser and your tenant, so this check signs its own session cookie with
the Auth0 SDK's testing helper (`@auth0/nextjs-auth0/testing`) instead. It never contacts Auth0 or
touches your tenant. It drives a real browser (Edge, already on Windows) through:

- the header for anonymous, verified and unverified visitors
- terms consent, the Dashboard link, and role-based redirects for buyer, builder and admin
- "List your project" creating exactly one builder account
- an unverified email, a malicious `returnTo`, and a forged cookie

```bash
# 1. disposable database with migrations
docker run -d --name rkb-e2e-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rkb_e2e -p 54330:5432 postgres:17-alpine
DIRECT_URL=postgresql://postgres:test@localhost:54330/rkb_e2e npx prisma migrate deploy

# 2. production build and server with dummy Auth0 values and a known session secret
npm run build
SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
DATABASE_URL=postgresql://postgres:test@localhost:54330/rkb_e2e \
AUTH0_DOMAIN=dummy.invalid AUTH0_CLIENT_ID=dummy AUTH0_CLIENT_SECRET=dummy AUTH0_SECRET=$SECRET \
ADMIN_EMAILS=admin@test.example APP_BASE_URL=http://localhost:3130 PORT=3130 npm start

# 3. in a second terminal
node tests/e2e/logged-in-flows.mjs "$(pwd)" http://localhost:3130 $SECRET

# 4. clean up
docker rm -f rkb-e2e-pg
```

Start from an empty database each time: the script expects to create the first user and the first
builder. What it cannot cover: the real Auth0 pages (sign-up form, verification email, password
rules). Check those by hand with the steps in `docs/SETUP-PHASE-1.md`.

## Builder onboarding end-to-end check

Same idea as the logged-in check above, for the whole verification journey: profile autosave,
document upload (including a fake PDF that must be refused), submit, admin review with a document
sent back, resubmission, approval, locked fields for verified builders, and privacy of documents.
It also reads the mail outbox and the storage folder to confirm emails were sent and that
replaced or refused files were really deleted.

It needs local file storage and the dev mail outbox, both pointed at one fresh folder:

```bash
DIR="$TEMP/rkb-e2e-run"          # any new, empty folder
mkdir -p "$DIR"
docker run -d --name rkb-e2e-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rkb_e2e -p 54330:5432 postgres:17-alpine
DIRECT_URL=postgresql://postgres:test@localhost:54330/rkb_e2e npx prisma migrate deploy
npm run build

SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
DATABASE_URL=postgresql://postgres:test@localhost:54330/rkb_e2e \
AUTH0_DOMAIN=dummy.invalid AUTH0_CLIENT_ID=dummy AUTH0_CLIENT_SECRET=dummy AUTH0_SECRET=$SECRET \
ADMIN_EMAILS=admin@test.example APP_BASE_URL=http://localhost:3130 PORT=3130 \
STORAGE_DRIVER=local LOCAL_STORAGE_DIR="$DIR/storage" MAIL_DRIVER=file MAIL_OUTBOX_DIR="$DIR" \
npm start

# second terminal
node tests/e2e/builder-onboarding.mjs "$(pwd)" http://localhost:3130 $SECRET "$DIR"
```

The database and the folder must be empty at the start, so use a fresh folder and a new
container for each run.

What it cannot check: the real Cloudinary and Resend services. Use `npm run storage:check` and
`npm run mail:check -- you@example.com` for those once your accounts exist.

## Projects and plots end-to-end check

Drives the whole project journey in a real browser: create a project, fill the wizard (with the
autosave rules), add plots by hand, as a series, and from CSV and Excel files with deliberate
mistakes, change statuses singly and in bulk, edit and delete, add approvals with certificates,
upload photos, layout plan and brochure, preview, submit (blocked until the company is verified),
admin review with a requested change, resubmit, verify and approve, then the live-project rules,
the plan limit, privacy between builders, and finally a crawl of every link on the builder and admin
pages plus a phone-width check.

Same setup as the onboarding check above (a fresh database and a fresh folder), plus the database
address as a fifth argument, because the test makes the builder "verified" directly in the database
at the point it needs it:

```bash
node tests/e2e/projects.mjs "$(pwd)" http://localhost:3130 $SECRET "$DIR" "$DATABASE_URL"
```

Things automated tests do not cover: the 40-photo plan limit (it is enforced in the upload route,
but only exercised by hand), and the real Cloudinary and Resend services.

## Which test needs what

| Command | Needs |
|---|---|
| `npm test` | nothing (database tests are skipped) |
| `TEST_DATABASE_URL=... npm test` | a Postgres with the migrations applied |
| `node tests/e2e/logged-in-flows.mjs ...` | a server and an empty database |
| `node tests/e2e/builder-onboarding.mjs ...` | the same, plus local storage and the dev mail folder |
| `node tests/e2e/projects.mjs ...` | the same, plus the database address |

## Marketplace end-to-end check

Checks the public side: what is and is not public, search and filters, city pages, the project
and builder pages, structured data, the sitemap and icons, saving projects, sharing, the phone
layout, and that changes by a builder or the admin show up for buyers at once. The script adds
builders, projects and plots straight to the database (so it needs an empty one); everything
buyers, the builder and the admin do goes through the real pages.

```bash
docker run -d --name rkb-e2e-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rkb_e2e -p 54330:5432 postgres:17-alpine
DIRECT_URL=postgresql://postgres:test@localhost:54330/rkb_e2e npx prisma migrate deploy

DIR="$TEMP/rkb-mkt-run"; mkdir -p "$DIR"
SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
export DATABASE_URL=postgresql://postgres:test@localhost:54330/rkb_e2e   AUTH0_DOMAIN=dummy.invalid AUTH0_CLIENT_ID=dummy AUTH0_CLIENT_SECRET=dummy AUTH0_SECRET=$SECRET   ADMIN_EMAILS=admin@test.example APP_BASE_URL=http://localhost:3130 PORT=3130   STORAGE_DRIVER=local LOCAL_STORAGE_DIR="$DIR/storage" MAIL_DRIVER=file MAIL_OUTBOX_DIR="$DIR"
npm run build        # against the same empty database
npm start

# second terminal, same variables
node tests/e2e/marketplace.mjs "$(pwd)" http://localhost:3130 $SECRET "$DATABASE_URL"
```

Build and start again (and use a new database) for every run: cached pages are stored under
`.next`, and the script expects to start from "nothing is live yet".

Notes for writing browser checks here: do not rely on Playwright's `networkidle` alone. Next keeps
prefetching other pages in the background, so the network is often busy for seconds.

## Buyer and builder accounts check

`tests/e2e/roles.mjs` checks the login page and the two-accounts behaviour: where each door leads,
what a buyer sees and does not see, what a builder sees and does not see, switching without logging
out, deep links, forged cookies, logging out, the admin, and the phone layout. Sessions are signed
with the Auth0 testing helper, so no real login is used. Run it like the marketplace check (fresh
empty database, build, start with `ADMIN_EMAILS=admin@test.example`), then:

```bash
node tests/e2e/roles.mjs "$(pwd)" http://localhost:3130 $SECRET "$DATABASE_URL"
```
