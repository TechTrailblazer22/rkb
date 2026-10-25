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
