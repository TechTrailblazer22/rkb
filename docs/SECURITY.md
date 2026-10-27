# Security, privacy and hardening (Phase 10)

What protects the site and the people who use it, what was tested, and what is left to you. The
browser test is `tests/e2e/hardening.mjs`; the static access check is `scripts/audit-access.mjs`.

## Who can do what

Identity comes from Auth0 (a verified email). **Everything else is ours**: a person's stored role
(buyer, builder owner, builder team, admin) and their membership of a company live in our database,
and the account in use (buyer or builder) is a display preference in a cookie that never grants
anything (`docs/LOGIN-ROLES.md`). Every page, server action and route handler checks the person
itself; the proxy is only a first gate.

- **Company data is found from the login, never from an id in the address or a form.** A project, a
  lead, an invoice or a booking id from another company is simply "not found".
- **Roles inside a company.** Owner: everything. Manager: projects, plots, leads, promote, reviews,
  submit/reopen/archive. Staff: projects, plots and leads. Billing, the team, the company profile,
  documents, plan and review pages (and their actions, the logo/document upload and the
  identity-document download) are owner-only; others are redirected or get "not found".
- **Staff (admin)** pages need the ADMIN role; every admin action checks it again. Admin views of
  private documents are written to the audit log.
- `node scripts/audit-access.mjs` lists every route handler, server action and page and which guard
  each contains, and fails if one has none. Public ones are listed with the reason. Run it after
  adding any route.

## Headers and the Content-Security-Policy (`next.config.ts`)

Every response carries: a CSP (no object embeds, no framing of our pages, no base-tag changes,
scripts/frames/connections only to ourselves and the services in use: Razorpay's checkout, YouTube's
privacy player, Cloudinary images), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a
strict `Referrer-Policy`, a `Permissions-Policy` that turns off camera, microphone, geolocation and
USB, and (in production) HSTS for two years. `X-Powered-By` is removed.

Honest limit: the policy allows inline scripts (`'unsafe-inline'`), because Next.js's own scripts and
the account-mode script in the root layout need them, and a per-request nonce would make every page
dynamic and end the static caching the public pages rely on. It still blocks injected script from
other origins, framing, plugin content and base-address tricks. `hardening.mjs` loads every kind of
page as a visitor, buyer, builder and admin and fails on any policy violation, and checks that the
video frame, layout map and progress updates render.

## Abuse limits

`lib/rate-limit.ts` (a fixed window, in memory, one server process: right for one Render instance, a
shared store would be needed for several): page-analytics beacon 90/minute per address, saving a
project 120/minute per person, file uploads 60/minute per person, construction updates 20/hour,
holding plots 20/hour per buyer, reviews 15/hour. Enquiries have their own database-backed limit
(5 a day per buyer) and a honeypot field. Gateway webhooks are protected by their signature, not by
a limit.

## Money

Documented in `docs/BILLING.md` and `docs/BOOKING.md`: amounts checked against the order, signatures
checked in constant time before a body is read, every settlement idempotent and locked, late money
never kept silently, refunds claimed before they are sent, concurrency tests for all of it. The test
gateway refuses to start in production unless `ALLOW_TEST_BILLING=yes`.

## Your data (DPDP Act)

`/account/privacy`: **download** everything held about you (a JSON file, only your own, never what a
builder wrote about you), and **delete your account**. Deleting anonymises: name, mobile and email
are replaced and the login is cut off (so signing in again starts a fresh empty account), saved
projects and reviews are removed, a builder's leads stay (their own business record) without your
details, and messages you wrote in them are replaced. Money records are kept with the contact
details removed, and erasure waits until a paid or refund-due token is settled. Staff and company
accounts are handled by us on request. Your sign-in identity at Auth0 is not deleted by this; that
is done in Auth0. Leads, bookings and invoices may need to be kept for a period the law sets: **take
advice on retention periods and write them into the Privacy Notice**.

## Dependencies

`npm audit` reported 0 vulnerabilities at the time of the final audit. Re-run it before each deploy;
Next.js and Auth0 are the packages that matter most.

## Secrets

`.env` holds secrets and is not committed. Production secrets live in Render's environment:
`AUTH0_*`, `CRON_SECRET` (generated), `CLOUDINARY_URL`, `RESEND_API_KEY`, `RAZORPAY_*`,
`DATABASE_URL`/`DIRECT_URL`. The cron routes are off unless `CRON_SECRET` (16+ characters) is set and
compare it in constant time. Rotate a secret by changing it in Render and redeploying.

## Known limits and things to do before launch

- No third-party penetration test has been done. Consider one before real money moves.
- Rate limits are per process (above). The session lifetime is Auth0's.
- A malicious company could still write misleading text; the controls are staff review of
  verification, projects and reviews, not code.
- Uploaded files are checked by content (JPG, PNG, WebP, PDF) and size, but are not scanned for
  malware.
- Email addresses entered for team invitations are not verified until the person logs in with them.
- Privacy Notice and Terms are drafts for a lawyer to finalise (see `docs/PHASES.md`).
