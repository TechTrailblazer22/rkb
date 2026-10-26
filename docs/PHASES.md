# RKB Platform: Phase-wise Plan (Render + Auth0)

This replaces the stack, folder layout and phase table in [PLAN.md](PLAN.md). The product scope, screens, onboarding design (section 5), data model (section 9) and risks in PLAN.md still apply.

---

## 1. What the free tiers force us to change

Checked against Render's and Auth0's own docs on 2026-10-25. Re-check before you rely on any of it.

| Constraint | Consequence for the design |
|---|---|
| **Render free web service sleeps after 15 min idle**; wake-up takes about a minute | The first visitor after a quiet spell waits ~1 min. Fine for building and demos, **bad for buyers, SEO and paying builders**. Mitigation: an external pinger (UptimeRobot, 5 min). That fits in the 750 free hours only for **one** always-on service, so we run **one web service only**. |
| **750 free instance hours per month** per workspace | One service running 24/7 uses ~744 h. A second free service would exceed it. So: one monolithic Next.js app, no separate API or worker services. |
| **Render free Postgres expires after 30 days** (14-day grace), 1 GB, no backups | Do **not** use it. Use an external free Postgres: **Neon** (recommended, scale-to-zero, Singapore region) with pooled URL for runtime and direct URL for migrations. Verify Neon's current free limits. |
| **No persistent disk; filesystem wiped on every restart** | No local uploads, ever. All files go to object storage: **Cloudinary** (free, no card needed) for photos/brochures, plus signed "authenticated" assets for KYC documents. |
| **No free background workers or cron jobs** | No pg-boss queue. Scheduled work (approval-expiry pause, follow-up reminders, hold release, digests) becomes **HTTP endpoints under `/api/cron/*`** protected by a secret, triggered by a free external scheduler (**cron-job.org** or GitHub Actions). Work done inline where possible. |
| **Outbound SMTP ports 25/465/587 blocked** | Email through an **HTTP API** (Resend free tier), not SMTP. |
| **Free web service: 1 instance, no shell, no one-off jobs** | Run `prisma migrate deploy` in the build command, not by hand. Seed from a script run locally against Neon or from GitHub Actions. |
| **Limited RAM and build minutes** | Keep the app lean, avoid heavy server-side image processing (let Cloudinary transform), watch build memory. |
| **Auth0 Free: 25,000 MAU, social + email/password, 5 Actions, no RBAC feature, no MFA** | Auth0 handles **identity only** (who you are). **Roles and permissions live in our own database.** No dependence on Auth0 RBAC, Organizations or MFA. |
| **Auth0 custom domain needs a card** | Use the default `*.auth0.com` tenant domain for now. |
| **Phone OTP via Auth0** | Free-plan docs did not make SMS passwordless clear. In India, SMS also needs a provider (Twilio or similar) **plus DLT registration**, which takes days to weeks. So v1 login = **Google + email/password via Auth0**. Mobile numbers are collected and verified separately (Phase 6). |

**Honest verdict on "free":** this stack is right for **development, demos and a pilot with a few builders**. Once real builders are paying ₹3k to ₹20k/month, cold starts and an ephemeral host are not acceptable. Phase 10 is the planned move to a paid Render instance (about $7/month) plus a paid database. The code needs no change, because everything above is already externalised.

---

## 2. Final stack

| Concern | Choice |
|---|---|
| App | **Next.js (App Router) + TypeScript**, one service, SSR/ISR |
| UI | Tailwind CSS, shadcn/ui, lucide-react, react-hook-form + Zod |
| Auth | **Auth0** via `@auth0/nextjs-auth0` (Universal Login, Google + email/password) |
| Authorisation | Roles in our DB (`User.role`, `BuilderMember.role`), one `can()` helper, enforced server-side |
| DB | **Neon Postgres** + Prisma; search with `pg_trgm` and `tsvector` |
| Files | **Cloudinary** (public media + signed private KYC docs) |
| Email | **Resend** (HTTP API) |
| WhatsApp | v1: free **click-to-chat links** (`wa.me`) and prefilled messages. WhatsApp Business API later. |
| Scheduling | `/api/cron/*` + cron-job.org / GitHub Actions |
| Hosting | **Render** free web service, auto-deploy from GitHub, `render.yaml` blueprint |
| Monitoring | UptimeRobot (keep-warm + uptime), Sentry free tier |
| Payments | Razorpay (Phase 8 and 9) |
| Maps | Leaflet + OpenStreetMap |

**Repo layout** (single app, not a monorepo, since there is only one service):
```
rkb/
├─ src/app/ (public) (auth) (buyer) (builder) (admin) api/
├─ src/components/   src/lib/ (auth, rbac, entitlements, db, storage, mail, cron)
├─ prisma/ (schema.prisma, migrations, seed.ts)
├─ render.yaml   .env.example   .github/workflows/
└─ docs/ (PLAN.md, PHASES.md)
```

---

## 3. Phases at a glance

| # | Phase | Outcome | Est. |
|---|---|---|---|
| 0 | Foundation and deployment pipeline | "Hello RKB" live on Render, DB connected | 3 to 4 days |
| 1 | Auth0 login and roles | People can sign up/in; builder vs buyer paths; admin exists | 1 wk |
| 2 | Design system and marketing site | Attractive Home, For Builders, Pricing pages, usable to recruit builders | 1.5 wk |
| 3 | Builder onboarding and verification | Builder registers, fills profile, uploads KYC; admin approves | 2 wk |
| 4 | Project wizard and inventory | Builder creates a full project incl. plots and Excel import; admin approves it | 3 wk |
| 5 | Public marketplace | Buyers search, filter, view project and builder pages | 3 wk |
| 6 | Leads, alerts and mobile verification | Enquiry to inbox to alert; scheduled jobs | 2 wk |
| 7 | Plans and entitlements | Plan limits enforced; admin assigns plans (manual billing) | 1 wk |
| 8 | Subscription billing | Razorpay subscriptions + GST invoices | 1.5 wk |
| 9 | Analytics, reviews, layout map editor | Growth/Premier features | 3 wk |
| 10 | Online booking, hardening and moving off free tier | Token bookings (after legal sign-off); paid hosting; launch | 3 wk |

**MVP = phases 0 to 6, about 13 weeks.** It delivers the proposal's headline promise: verified builders, full project pages, live plot inventory, and leads with alerts. Billing is manual until Phase 8, which is fine for the first founding builders.

Each phase ends with: merged to `main` → auto-deployed to Render → a short demo script passes on the live URL.

---

## Phase 0: Foundation and deployment pipeline (3 to 4 days)

Deploy first, build second. Proving the pipeline now avoids surprises later.

**Tasks**
1. `git init`, create a GitHub repo (private), `.gitignore`, `.env.example`.
2. Scaffold Next.js + TypeScript + Tailwind + shadcn/ui, ESLint, Prettier, Vitest, Playwright skeleton.
3. Create the **Neon** project (Singapore region). Save `DATABASE_URL` (pooled) and `DIRECT_URL`.
4. Prisma schema v0 (`User` only) + first migration; Prisma client singleton for serverless-style connection reuse.
5. `GET /api/health` (liveness, no DB) for Render and UptimeRobot, plus `GET /api/health/db` (readiness). The DB check is kept off Render's health check on purpose: a Neon cold start would make Render think the service is down.
6. Write `render.yaml`: one free web service, region Singapore (confirm it is offered), build `npm ci && npx prisma migrate deploy && npm run build`, start `npm start`, health check path, env var keys.
7. Connect the GitHub repo to Render and deploy.
8. Set up UptimeRobot (5 min ping) and Sentry.
9. GitHub Actions CI: lint, typecheck, unit tests on every PR.
10. Create the **Auth0 tenant** and a Regular Web Application; record the domain and client id. (Wiring comes in Phase 1.)

**Done when:** the live Render URL shows a page, `/api/health` returns OK with a DB check, a push to `main` redeploys automatically, and CI is green.

**Watch out:** if the Render build runs out of memory, set `NODE_OPTIONS=--max-old-space-size=460`, trim dependencies, or build in GitHub Actions and deploy a Docker image.

---

## Phase 1: Auth0 login and roles (1 week)

**Design**
- Auth0 proves identity. On first login the app **upserts a `User` row keyed by the Auth0 `sub`**. Role and builder membership are ours.
- Two entry paths: **Buyer** (default "Log in / Sign up") and **Builder** ("List your project" → `/auth/login?screen_hint=signup&returnTo=/portal/onboarding`). The builder path creates a `Builder` in `DRAFT` and sets the role on first completion.
- **Admins** are set through an `ADMIN_EMAILS` env allowlist at first login, then managed in the admin console. Never self-assignable.

**Tasks**
1. Install `@auth0/nextjs-auth0`; routes `/auth/login`, `/auth/logout`, `/auth/callback`; env vars `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`.
2. Auth0 dashboard: callback/logout URLs for localhost and the Render URL; enable Google social login; require verified email; customise the Universal Login look (logo, navy/teal).
3. Prisma: `User(id, auth0Sub, email, name, mobile, role, createdAt)`, `Builder`, `BuilderMember`.
4. `getCurrentUser()` helper (session → DB user), `requireRole()`, `can(user, action, resource)`.
5. Route protection: `proxy`/middleware for `/portal/*`, `/admin/*`, `/account/*`; server-side checks too (middleware alone is not enough).
6. Header: login/logout, user menu, role-aware links.
7. Consent capture: terms and privacy acceptance stored with a version and timestamp.
8. Tests: unauthenticated redirects, buyer cannot open `/portal`, builder cannot open `/admin`, admin allowlist.

**Done when:** on the live site you can sign up with Google or email, land in the right area for your role, log out, and are blocked from areas you don't own.

**Watch out:** Auth0 free tenants can be rate-limited on login and there are only 5 Actions. Avoid Actions for core logic; keep it in the app. Don't store roles in Auth0.

---

## Phase 2: Design system and marketing site (1.5 weeks)

Doing this before the heavy builder work gives you something to **show builders** while the rest is built. The proposal PDF is essentially a sales page.

**Tasks**
1. Tokens in `tailwind.config` (navy, teal, amber, slate); Inter font; spacing, radius, shadows (see PLAN.md 3.2).
2. Core components: `Button`, `Input`, `Select`, `Badge` (Verified, RERA), `PlotStatusChip`, `Card`, `Tabs`, `Stepper`, `FileDropzone`, `Skeleton`, `Toast`, `Header`, `Footer`, mobile bottom-sheet.
3. `ProjectCard` and `BuilderCard` built against **mock data**.
4. **Home**: hero with search card and the animated plot-grid art, rails with seeded sample projects, trust strip, city links.
5. **/for-builders**: the proposal reproduced as web copy (problem/solution, how it works, features, built for every developer, FAQ, CTA to register).
6. **/pricing**: three plan cards, monthly/annual toggle ("pay 10 months, get 12"), GST note, comparison table.
7. Legal pages: terms, privacy (DPDP), disclaimer ("listing and booking facilitation service").
8. SEO basics: metadata, OG images, sitemap, robots. Mobile-first at 360px; Lighthouse and axe checks.

**Done when:** the three marketing pages look polished on phone and desktop, pass a Lighthouse mobile check (performance ≥ 80 despite free hosting) and the "Register as builder" CTA enters the Phase 1 flow.

---

## Phase 3: Builder onboarding and verification (2 weeks)

This is the core of your request: the builder fills in everything himself. Full design is in PLAN.md section 5.

**Tasks**
1. **Prisma:** `Builder` (full fields), `BuilderDocument`, `Plan` (seeded), `AuditLog`.
2. **Onboarding flow** at `/start-listing` (account creation) then `/portal`:
   - Step A account (already done by Auth0) + mobile number + consent.
   - Step B business profile (company, type, year, office address, pin, about, logo/cover, contact person, WhatsApp, service cities).
   - Step C documents (PAN, GST, business proof, identity, address, RERA, bank details). PAN and GSTIN format validation with Zod.
   - Step D choose a plan (**no payment yet**; selection recorded as "interested plan").
3. **Autosave** each step; resume where left off; "Get live" checklist with progress ring on the dashboard.
4. **Uploads:** server issues a Cloudinary signed upload; public assets (logo, cover) vs **authenticated** assets (KYC) served only through signed, short-lived URLs to the owner and admins. Type/size limits.
5. **Admin console v1:** verification queue (list, filter by status), builder detail with documents viewer, actions: Approve, Reject, Request changes with a note. Each action writes `AuditLog`.
6. **Emails** (Resend): submitted, approved, changes requested.
7. **Verified Builder badge** shown on builder profile once approved.
8. Seed script: demo builders at every status.

**Done when:** a new builder can sign up, complete profile and documents on a phone, submit; an admin sees it, requests a change, the builder fixes and resubmits, admin approves, the builder gets an email and the badge appears. All covered by one Playwright test.

**Watch out:** never store full Aadhaar numbers. Documents are never public. Cloudinary free credits are limited, so compress images client-side before upload.

---

## Phase 4: Project wizard and plot inventory (3 weeks)

**Tasks**
1. **Prisma:** `Project`, `ProjectSection` (autosave drafts), `ProjectApproval`, `ProjectMedia`, `Amenity`, `ProjectAmenity`, `Phase`, `Plot`, `PlotStatusLog`.
2. **Wizard** (10 steps, PLAN.md 5.6): Basics, Size and layout, Plots and units, Legal and approvals, Timeline, Pricing, Amenities, Media, Contact, Review and submit. Stepper on desktop, progress bar on mobile. Autosave every ~800 ms. **Completeness score** with weighted missing-field list.
3. **Plot inventory:**
   - editable table (add, edit, delete rows, inline status change);
   - **Excel/CSV import** (SheetJS or ExcelJS): downloadable template → upload → parse → row-level error preview → confirm → transactional insert;
   - "Generate series" tool.
4. **Media:** gallery with drag-reorder, cover, tags, brochure PDF, YouTube link. Limits read from the plan config (stubbed to Growth limits until Phase 7).
5. **Map pin** picker (Leaflet), locality autocomplete from seeded `City`/`Locality`.
6. **Preview as buyer** page that renders the exact public layout (Phase 5 reuses it).
7. **Project state machine:** `DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED → LIVE → PAUSED → ARCHIVED`, with a single `transitionProject()` service and audit logging.
8. **Admin project review:** approval documents viewer, per-approval "verified" toggle, approve/reject/request changes.
9. Plot status changes by the builder, logged in `PlotStatusLog`. Duplicate detection (same RERA number, same name plus locality).
10. Duplicate project and "copy from previous project".

**Done when:** a builder creates a 60-plot project from scratch (including Excel import with deliberate errors), submits, the admin approves, and it shows as LIVE in the database. Edits to material fields send it back to review; cosmetic edits do not.

---

## Phase 5: Public marketplace (3 weeks)

**Tasks**
1. **Search** `/projects/[city]/[type]` with URL-driven filters (budget, plot size, facing, approval, stage, amenities, verified only), sort, pagination, list/map toggle. Postgres full-text and trigram; indexes from PLAN.md section 9.
2. **Project detail** `/project/[slug]`: gallery and lightbox, sticky contact card (bottom bar on mobile), anchor tabs, live plot table with status filters, amenities, approvals panel with "Verified on {date}", map, progress updates placeholder, builder card, similar projects.
3. **Builder profile** `/builder/[slug]`.
4. **Home** switched from mock data to real queries; city and locality landing pages for SEO.
5. **Shortlist** (login required), recently viewed (local storage), share via WhatsApp with OG preview.
6. **Rendering strategy:** ISR (`revalidate`) with on-demand revalidation when a builder changes a project or plot status, so most visits are served from cache even when the server is cold-ish.
7. JSON-LD, sitemap generation, canonical URLs.
8. **PWA:** manifest, icons, installable.
9. Performance: Cloudinary transforms (`f_auto,q_auto`, responsive sizes), lazy loading, skeletons.

**Done when:** on a phone, you can find a seeded project by city and budget, open it, filter its plots, shortlist it, and share it; Lighthouse SEO ≥ 90.

---

## Phase 6: Leads, alerts and mobile verification (2 weeks)

**Tasks**
1. **Enquiry flow:** "Contact Builder" opens a form (name, mobile, message, preferred plot, consent checkbox). Login via Auth0 required, or a lighter option if you prefer (see questions).
2. **Mobile verification:** start with an OTP provider that works in India (MSG91 or similar). SMS DLT registration takes time, so **begin the application at the start of Phase 3**. Until approved, fall back to email verification and mark the mobile "unverified".
3. **Lead inbox** `/portal/leads`: pipeline (New, Contacted, Site visit, Negotiation, Booked, Lost), notes, assign to team member, follow-up date, CSV export, filters, per-project view. Basic vs full dashboard flag (enforced in Phase 7).
4. **Alerts:** instant email (Resend) to the builder; **WhatsApp click-to-chat** deep link on each lead for a one-tap reply; daily digest.
5. **Site-visit requests** with date/time and status.
6. **Scheduled jobs** (`/api/cron/*`, secret header, triggered by cron-job.org every 15 min / daily):
   - follow-up reminders,
   - approval-expiry pause and 30/7/1-day warnings,
   - stale-inventory nudge ("confirm your inventory"),
   - weekly digest.
   Handlers must be idempotent, quick, and safe if triggered twice.
7. Buyer area: my enquiries and status.
8. Rate limiting and spam protection on enquiries (CAPTCHA, limits per mobile/IP).

**Done when:** a buyer enquires on the live site; within seconds the builder gets an email and sees the lead; the builder moves it through the pipeline; a reminder fires from the scheduler.

---

## Phase 7: Plans and entitlements (1 week)

**Tasks**
1. `Plan` table with limits and flags (projects, photos, video, team users, layout map, featured days, analytics level) seeded from the proposal: Starter ₹2,999, Growth ₹7,999, Premier ₹19,999 per month (+18% GST).
2. `entitlements(builder)` helper, the **single** place plan logic lives. Enforce in UI and server actions: project count, photo cap, team seats, feature gating, featured days.
3. **Manual billing for now:** the admin assigns a plan, sets the period end and marks "paid" with a reference; an invoice record is created. Founding-builder coupons are applied here.
4. Team members: invite by email, roles, seat limit.
5. Publish gate: a project goes LIVE only if the builder is verified **and** has an active plan.
6. Lapse behaviour: listings stay live until the paid period ends, then become PAUSED; data is kept; reminders before expiry (cron).
7. Plan ranking boost in search (Premier priority) and "Featured" label, plus homepage spotlight slot.

**Done when:** a Starter builder cannot create a third project or a 16th photo, upgrading unlocks it instantly, and a lapsed plan pauses listings on schedule.

---

## Phase 8: Subscription billing (1.5 weeks)

**Tasks**
1. Razorpay account in test mode; create plans (monthly and annual).
2. Checkout for subscription, webhooks (`subscription.activated/charged/halted/cancelled`) verified by signature, idempotent processing.
3. Cancel any time, access until period end; upgrade/downgrade with proration; downgrade blocked if over limits.
4. **GST invoices** (PDF generation that works without a persistent disk, e.g. generate on demand or store in Cloudinary): GSTIN, SAC code, CGST+SGST vs IGST by state. Confirm details with your CA.
5. Billing page for the builder; failed-payment retry messaging.
6. Replace the manual billing screen in the admin console with a payments view.

**Done when:** in test mode, a builder subscribes, gets an invoice, upgrades, cancels, and entitlements follow each change.

---

## Phase 9: Analytics, reviews, layout map editor (3 weeks)

1. **Event tracking** (views, contact clicks, shortlist, enquiry, visit) written cheaply and batched; dedupe by session; aggregate tables updated by a cron job to protect the free DB.
2. **Builder analytics:** per-project views, enquiries, visits, conversion funnel, source; monthly performance email; export for Premier.
3. **Reviews and ratings:** only from buyers with a logged enquiry, visit or booking; admin moderation; builder public reply; verified-buyer label.
4. **Layout map editor:** upload layout image, then draw one polygon per plot (SVG), link each polygon to a plot record. The buyer view shows the clickable coloured layout (Available/Booked/Sold). Growth and above.
5. **Construction progress updates** (photos plus note) with notification to shortlisters.
6. Featured-days scheduling and the Premier homepage spotlight.

**Done when:** a Growth builder draws a 40-plot layout in under 15 minutes, buyers click plots on a phone, and reviews are moderated end to end.

---

## Phase 10: Online booking, hardening and moving off the free tier (3 weeks)

**Gate before starting:** legal sign-off on token amount cap, refund/cancellation policy, who bears gateway fees, and the facilitator-only positioning (RERA advance rules). Razorpay Route (linked accounts) approval requested earlier.

**Tasks**
1. **Booking:** plot hold (15 min) using a row lock so two buyers can't take one plot, Razorpay order with Route transfer to the builder's linked account, **webhook-driven confirmation**, receipt PDF, refund flow, hold-release cron, daily reconciliation. Feature-flagged; until enabled, "Book" falls back to "Request booking" (a priority lead).
2. A **concurrency test**: parallel bookings of one plot, exactly one wins.
3. **Move to paid hosting:** Render Starter web service (no sleep, ~$7/mo) and a paid Postgres with backups (Neon paid or Render Postgres); a dedicated Render cron or worker if wanted; custom domain and TLS; Auth0 custom domain.
4. Security pass (rate limits, headers, dependency audit, secret rotation), DPDP flows (export and delete requests, retention), accessibility pass, load test.
5. Backups and restore drill; error alerting; status page.
6. Launch checklist: legal pages final, seed launch-city content, onboard the first 20 to 30 builders by hand (the proposal's "free first listing" offer), founding-builder campaign.

**Done when:** a test-mode token booking works end to end, the restore drill passes, and the site runs on always-on hosting with a custom domain.

---

## 4. Environment variables (grows by phase)

| Phase | Variables |
|---|---|
| 0 | `DATABASE_URL`, `DIRECT_URL`, `NODE_ENV` |
| 1 | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, `ADMIN_EMAILS` |
| 3 | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RESEND_API_KEY`, `MAIL_FROM` |
| 6 | `CRON_SECRET`, `SMS_PROVIDER_KEY`, `RECAPTCHA_*` |
| 8 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| 10 | `RAZORPAY_ROUTE_*`, Sentry DSN |

Secrets live in Render's environment settings, never in git.

## 5. Cross-cutting rules (every phase)

- **Server-side authorisation always.** Every builder query is scoped by `builderId`.
- **No local file writes.** Everything persistent goes to Neon or Cloudinary.
- **Cron handlers are idempotent** and quick; they must tolerate a cold start.
- **Plan checks go through `entitlements()` only.**
- **Migrations are additive** and run at build time; test against a Neon branch before merging.
- **Seed data stays realistic** so every page can be demoed.
- Each phase ships with tests, a demo script, and an update to `docs/`.

## 6. Things to start early (they have long lead times)

1. **SMS DLT registration** (India): start in Phase 3.
2. **Razorpay account and Route approval**: start by Phase 6.
3. **Legal review** of token/refund/terms: before Phase 10, ideally earlier.
4. **Domain name**: buy now, attach in Phase 10 (or earlier for Auth0 callbacks and branding).
5. **Brand assets**: logo and colours by Phase 2.

## 7. Assumptions I made (change any of these)

1. Login is **Google + email/password** in v1; phone OTP arrives in Phase 6.
2. **Neon** replaces Render's free Postgres, because Render's expires in 30 days.
3. **Cloudinary** for files and **Resend** for email.
4. Billing is manual until Phase 8.
5. Booking stays behind a feature flag until legal sign-off.

---

## Phase 2 status (built)

Delivered: design tokens and UI primitives (`src/components/ui`), `ProjectCard` with sample data (`src/lib/sample-projects.ts`, clearly labelled "Sample listing"), Home, For Builders, Pricing (monthly/annual toggle driven by `src/lib/plans.ts`), a "marketplace opens soon" Projects page, draft Terms / Privacy / Disclaimer pages, `robots.txt`, `sitemap.xml`, favicon and social-share image, and a static header that learns the login state from `/api/me`.

Deliberately not done yet: real search and listings (Phase 5), PWA manifest (Phase 5), JSON-LD structured data (with real content), automated accessibility audit (CI step in a later phase), and the legal text itself (needs a lawyer).

## Phase 3 status (built)

Delivered: full builder profile with autosave and per-field validation (PAN, GSTIN with checksum, mobile, PIN), seven document kinds with private storage and expiring links, plan interest, a status machine (draft, under review, changes requested, verified, rejected, suspended), the admin queue and review screen with per-document decisions, audit history and duplicate PAN/GSTIN warnings, emails for submit/approve/changes/reject, a seed script, and storage and mail check scripts.

Differences from the original plan:
- **No `Plan` table.** Plans stay in `src/lib/plans.ts` until Phase 7; the builder only records an interested plan.
- **No bank account fields.** Only an optional cancelled-cheque upload; payout details belong with the payment provider in Phase 10.
- **No map pin** in the company profile. The location picker arrives with the project wizard in Phase 4, where it is needed.
- **Files go through our server** (not straight from the browser to Cloudinary) so every upload is checked for real file type, size and ownership first.
- **Routes** are `/portal` (overview), `/portal/profile`, `/portal/documents`, `/portal/plan`, `/portal/review`; admin is `/admin`, `/admin/builders`, `/admin/builders/[id]`.

Not verified against the real services: Cloudinary and Resend (no accounts yet). Run `npm run storage:check` and `npm run mail:check -- you@example.com` once they exist.

## Phase 4 status (built)

Delivered: projects with a 10-step autosaving wizard (basics, size and layout, plots, legal and approvals, timeline, pricing, amenities, media, contact, review), a completeness score with required and recommended items, plot inventory (add, edit, delete, a numbered-series generator, bulk status changes, an inline status dropdown, filtering, paging, and Excel/CSV import with a row-by-row preview), approvals with private certificates, photos with a cover plus a layout plan and brochure, a YouTube link, a buyer's-view preview, a project status machine (draft, under review, changes requested, live, paused, archived), an admin project queue and review screen with per-approval verification and duplicate-RERA warnings, emails for submitted, approved, changes requested and paused, and a plot status log.

Differences from the original plan:
- **No `ProjectSection` table.** Autosave writes straight into the project's own columns, which are all optional, so a draft can be saved at any point.
- **No `Amenity` or `ProjectAmenity` tables.** Amenities are a list of codes in `src/lib/projects/amenities.ts`.
- **No `Phase` table.** A plot has a free-text phase or block label.
- **No separate UNDER_REVIEW status.** SUBMITTED means under review.
- **Material edits on a live project** are locked (name, location, land use, title, bank loans, approvals) instead of triggering an automatic re-review. "Edit and resubmit" takes the listing offline until it is approved again. Everything else (photos, prices, plots, description) can be changed while live.
- **Template is CSV**, which opens in Excel. Uploads accept `.xlsx` and `.csv`.
- **Plan limits** (projects, photos, video) are read from one place (`src/lib/entitlements.ts`) and use the Growth limits for everyone until billing exists (Phase 7).

Deferred, on purpose:
- **Map pin picker and locality autocomplete.** The wizard has a map-link field, and city and locality are free text. A real picker needs map tiles and a locality list; revisit in Phase 5, where search needs consistent localities.
- **Drag-to-reorder photos.** Photos can be given a cover and removed.
- **Duplicate project and copy-from-previous.**
- **Automatic pausing of expired approvals.** An expired approval already blocks submitting and is flagged; the nightly pause arrives with the scheduled jobs in Phase 6.

## Phase 5 status (built)

Delivered:
- **Search** at `/projects`, `/projects/[city]` and `/projects/[city]/[type]`. Every filter lives in the address (search words, type, stage, budget, plot size, facing, approval, verified approvals only, amenities, sort, page), so a result can be shared, bookmarked and reached with the back button. The filter panel is a plain HTML form (works without JavaScript) that folds away on a phone. Price, size and availability are worked out from the live plots at the moment of the search, so a result can never disagree with the project page.
- **Project page** `/project/[slug]`: photo gallery with a full-screen viewer (arrow keys, Escape), a contact card that becomes a pinned bar on a phone, tabs that jump to sections, the live plot table (status chips with counts, plot search, show more), amenities, an approvals panel that says "Verified on {date}", pricing details, a link to the map, the builder card, and similar projects. It is the same component the builder's preview and the admin's review use.
- **Builder page** `/builder/[slug]` (only the public fields; PAN, GSTIN, address and phone are never sent).
- **Home** reads real projects and cities; until something is live it shows labelled sample cards.
- **Saved projects** (login needed): heart on cards and project pages, `/account/shortlist`, and a "Saved" link in the header. **Recently viewed** is kept in the visitor's own browser only. **Share** opens the phone's share sheet, or WhatsApp where there is none.
- **Caching:** project, builder and home pages are cached (`revalidate` of 2 and 5 minutes) and are refreshed straight away when a builder or the admin changes anything buyers can see (plot status, photos, details, approvals, pause or resume, a builder being verified or suspended). The hooks are in `src/lib/projects/revalidate.ts`.
- **SEO:** page titles and descriptions, canonical addresses, `noindex` for every filtered, sorted or paged variation (the plain city and type pages are indexed), JSON-LD (product and breadcrumbs on projects, organisation on builders), a sitemap that lists every public project, builder, city and city-and-type page, and real `404` answers for things that do not exist or are not public.
- **Installable app:** web manifest, 192/512 and Apple icons. There is no service worker, on purpose: live availability needs a connection.
- **Performance:** images use Cloudinary's automatic format and quality with a width per use (640 px on cards, 320 px thumbnails, 1200 px in the gallery), and are lazy loaded. There is no loading skeleton on the list: a `loading.tsx` file makes Next stream the page title and description into the body instead of the head, and makes a missing city answer `200` instead of `404`. The queries take a few milliseconds. With local file storage in development, files are served as uploaded.
- `npm run db:seed -- --yes` now also creates four LIVE demo projects (with plots and verified approvals) under the verified demo builder, so the marketplace has something to show locally.

Checked with Lighthouse 12 (mobile settings, against a production build with seeded data): project page, list page and builder page score **100** for SEO, accessibility and best practices, with no layout shift. Performance was 83 to 94 on a laptop with the Next server running locally and no CDN; the slowest part is the largest image, which Cloudinary resizes in production. Re-measure on the Render URL once real photos exist.

What is public: a project is visible to the world only when it is **LIVE** and its builder is **VERIFIED**. That rule lives in two places that are tested against each other (`src/lib/search/public.ts` and the search SQL).

Differences from the original plan:
- **No locality table or trigram index.** City and locality are still free text, and search uses case-insensitive matching on the project name, locality, city and company name. Cities are merged by spelling ("coimbatore" and "Coimbatore" are one page). Add `pg_trgm` indexes when the number of projects makes searches slow.
- **No list/map toggle.** There is a link to the builder's map pin on each project, but no map of results (it needs map tiles and coordinates).
- **No "progress updates" feed** on the project page, only the percent complete.
- **Phone and WhatsApp buttons** show only when the builder chose to show their number. Otherwise the card says enquiries go through RKB, and the enquiry form itself is Phase 6.
- **Full-text search** is not used; words are matched against name, locality, city and company.

Deferred, on purpose:
- Enquiry form, alerts for saved searches, price-drop notifications (Phase 6).
- Reviews and ratings (Phase 9).
- Locality autocomplete and a map of results.
