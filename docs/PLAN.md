# RKB Platform: Implementation Plan

> **Update:** hosting (Render free tier) and auth (Auth0) were decided after this was written. The stack (section 2), folder layout (section 10) and phase table (section 11) are superseded by [PHASES.md](PHASES.md). Everything else here still applies.

Source: `RKB_Platform_Builder_Proposal.pdf`. Goal: a MagicBricks / 99acres-style property marketplace where builders pay a monthly subscription (no commission), self-onboard, list projects with live plot inventory, receive leads and take token bookings.

---

## 1. What we are building

Three apps in one codebase, three audiences:

| Surface | Who | Purpose |
|---|---|---|
| **Public marketplace** | Buyers (mostly mobile) | Search, browse, shortlist, enquire, book a plot with a token |
| **Builder portal** | Builders and their team | Self-onboarding, project and plot management, leads, analytics, billing |
| **Admin console** | RKB staff | Verify builders and projects, moderate reviews, manage plans, support |

The proposal only describes the builder side. A marketplace with no buyer experience has no value to builders, so the buyer side is in scope and gets equal design effort.

---

## 2. Key decisions (assumptions to confirm, see section 14)

| Area | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | SSR/ISR gives SEO, which is the lifeblood of property portals. One codebase for UI and API. |
| Styling | **Tailwind CSS + shadcn/ui + Radix**, `lucide-react` icons | Fast, consistent, accessible. Easy to hit the polished look of the big portals. |
| Database | **PostgreSQL + Prisma** (PostGIS later if needed) | Relational data (builder → project → plot → booking), strong filtering, full-text search via `pg_trgm`/`tsvector`. |
| Auth | **Mobile OTP** (primary) + email magic link, **Auth.js** with custom provider | Indian users expect OTP. Roles: BUYER, BUILDER_OWNER, BUILDER_TEAM, ADMIN. |
| File storage | **S3-compatible** (Cloudflare R2 in prod, MinIO in Docker locally), presigned uploads | Photos, brochures, RERA PDFs, KYC docs. Private bucket for KYC. |
| Images | `next/image` + server-side resize to WebP (sharp) | Fast listing pages on weak mobile networks. |
| Maps | **Leaflet + OpenStreetMap** first, swappable for Google Maps | Zero cost at launch. Builder drops a pin. |
| Payments (token) | **Razorpay Route** (or Cashfree Easy Split) | Money settles to the builder's linked bank account, matching "token goes directly to your bank". |
| Payments (subscription) | **Razorpay Subscriptions** + GST invoices | Monthly or annual, cancel any time. |
| Notifications | SMS (MSG91), WhatsApp Business API (Gupshup/Meta), email (Resend) | Proposal promises SMS, email and WhatsApp alerts. |
| Background jobs | **pg-boss** (Postgres queue) | No Redis to run. Used for alerts, expiry checks, reports. |
| Validation | **Zod** shared by client forms and server actions; **react-hook-form** | One schema, one source of truth. |
| Hosting | Vercel or a VPS in **Mumbai region**, Neon/Supabase/RDS Postgres | Low latency for Indian users. |
| Mobile | **PWA** first (installable, "in every buyer's pocket") | Native apps only if usage justifies them. |
| Testing | Vitest (unit), Playwright (e2e), seed script with realistic demo data | |
| i18n | `next-intl`, English first, structure ready for Tamil/Hindi | The proposal mentions TNCP, which suggests a Tamil Nadu launch. |

---

## 3. Look and feel

### 3.1 What to borrow from the leaders
- **MagicBricks / 99acres / Housing.com** patterns that work: a big hero search with tabs, project cards that are image-first with price and a "Contact" button, sticky filters, a "Verified" trust badge, a sticky contact card on the detail page, "Similar projects" rails, and city/locality quick links for SEO.
- We keep the **patterns**, not their branding. Our identity comes from the proposal's palette.

### 3.2 Design tokens (from the proposal PDF)
| Token | Value (approx.) | Use |
|---|---|---|
| `navy-900` | `#0B2545` | Header, hero, footer, headings |
| `navy-700` | `#13315C` | Cards on dark, secondary surfaces |
| `teal-500` | `#13A89E` | Primary action, "Available", verified |
| `amber-500` | `#F5A300` | Accent, "Booked", highlights, underline bars |
| `slate-500` | `#3A5778` | "Sold" |
| `red-500` / `green-500` | semantic | Errors, success |
| Font | Inter (UI) + a heavier display weight for headlines | |
| Radius | 12px cards, 8px inputs, pill chips | |

Plot status colours are the same everywhere (grid, layout map, hero art): **Available = teal, Booked = amber, Sold = slate**.

### 3.3 Key screens

**Home**
- Sticky header: logo, city selector, "Buy / Plots / Farm houses / Commercial", "For Builders" link, Login.
- Hero (navy) with the headline from the proposal and a search card: city, locality, property type tabs, budget, "Search". The animated plot grid from the cover page becomes the hero visual.
- Rails: Featured projects, New launches, Ready to move, Verified builders, Explore by city, Explore by property type.
- Trust strip: Verified builders count, RERA-checked projects, "0% commission".
- Footer with SEO link blocks (projects in each city and locality).

**Search results** (`/projects/[city]/[type]`)
- Left filter panel (desktop) or bottom-sheet (mobile): budget, plot size, facing, approval (RERA/TNCP), status (pre-launch/ready), amenities, verified only, builder.
- Sort: relevance, price low/high, newest, most viewed.
- Project cards with image carousel, name, locality, price range and price/sq ft, plot sizes, "x of y plots available", approval chips, builder logo with Verified badge, Shortlist heart, **Contact Builder** and **Call/WhatsApp**.
- List/Map toggle (map pins with price).
- URL-driven filters (shareable, crawlable).

**Project detail** (`/project/[slug]`): the most important page.
- Gallery grid with lightbox and video; breadcrumb; title, locality, status, RERA number.
- **Sticky right card**: price range, token amount, "Book a plot with token", "Contact Builder", "Schedule site visit", WhatsApp. On mobile this becomes a sticky bottom bar.
- Sections with anchor tabs: Overview → Plots & pricing → Layout map → Amenities → Approvals → Location → Progress updates → Builder → Reviews → Similar projects.
- Live plot table with status filters; **interactive layout map** where clicking a plot shows size/facing/price and a Book button.
- Approvals panel: RERA number with a link to the state RERA site, plus validity dates.

**Builder profile** (`/builder/[slug]`): logo, verified badge, years in business, projects delivered, ratings, all their live projects.

**Buyer area**: shortlist, enquiries and their status, bookings and receipts, saved searches, profile.

**For Builders landing** (`/for-builders`): reproduces the proposal as web copy (why a platform, how it works, features, pricing cards, FAQ, "Register your builder account" CTA).

**Pricing** (`/pricing`): three plans with monthly/annual toggle (annual shows "pay 10 months, get 12"), GST-exclusive note, feature comparison table.

### 3.4 UX rules
- **Mobile first.** Most Indian property traffic is mobile. Design at 360px, then scale up.
- Fast: Lighthouse performance ≥ 85 on 4G, images lazy-loaded, ISR for project pages.
- Accessible: WCAG AA contrast (check teal-on-white for text; use darker teal for text), keyboard nav, labels on all inputs.
- Empty states, skeleton loaders and friendly errors everywhere.

---

## 4. Roles and access

| Role | Can do |
|---|---|
| Visitor | Browse and search; must verify mobile (OTP) to enquire or shortlist |
| Buyer | Shortlist, enquire, book token, review (after a booking or site visit) |
| Builder owner | Everything for their company, including billing and team |
| Builder team member | Limited per plan (3 users on Growth, 10 on Premier): manage leads and inventory, no billing |
| Admin / Verifier | Review KYC and projects, approve/reject/request changes, moderate reviews, impersonate for support |

Authorisation is enforced on the server in one place (a `can(user, action, resource)` helper), never only in the UI. Every builder-scoped query is filtered by `builderId`.

---

## 5. Builder self-onboarding (the core of your request)

Principle: **let the builder do everything themselves, in small saved steps, without ever losing work.** Verification happens in parallel and only gates *publishing*, not *data entry*.

### 5.1 Builder lifecycle

```
Register → Business profile → Documents → Choose plan → [Admin review] → VERIFIED
                                                              ↘ CHANGES_REQUESTED → fix → resubmit
```

A builder can enter the dashboard right after OTP signup. A **"Get live" checklist** (progress ring) stays on top of the dashboard until every step is done.

### 5.2 Step A: Create account (1 minute)
- Mobile number + OTP, name, email, password optional.
- Accept Terms and the DPDP privacy notice (consent recorded with timestamp and version).
- Role = BUILDER_OWNER; a `Builder` record is created in state `DRAFT`.

### 5.3 Step B: Business profile
Fields: company name, builder type (Proprietorship / Partnership / LLP / Pvt Ltd / Public), year established, projects completed, projects ongoing, office address + city + pincode, map pin, website, about (rich text, 500 chars), logo, cover image, contact person, WhatsApp number, service cities.

### 5.4 Step C: Verification documents
Matches "Builder verification" on page 3 of the proposal.

| Document | Data captured | Check |
|---|---|---|
| PAN (business) | PAN number + file | Format check now; API verification later |
| GST certificate | GSTIN + file | Format and checksum now; API lookup later |
| Business proof | Incorporation cert / partnership deed / udyam | Manual |
| Identity proof of signatory | Aadhaar masked / passport / voter ID | Manual (store masked, never full Aadhaar) |
| Office address proof | Utility bill / rent agreement | Manual |
| State RERA registration (builder-level) | Number + validity + file | Manual lookup on state RERA portal |
| Bank account | Account holder, number, IFSC, cancelled cheque | Needed for token payouts (Razorpay linked account KYC) |

Documents go to the **private** bucket, are served by short-lived signed URLs, and are visible only to the owner and admins.

### 5.5 Step D: Pick a plan
- Starter / Growth / Premier cards, monthly or annual, founding-builder discount code auto-applied by city if eligible.
- Builders can **start free in "setup mode"** (draft projects, no publishing) and pay at go-live. This lowers friction. The paywall appears at "Publish".

### 5.6 Project wizard (mapped 1:1 to "A complete project profile", page 3)

A left stepper on desktop, a top progress bar on mobile. Each step is its own form, **auto-saved** (debounced 800ms) as a draft section. The builder can leave and resume at any step. A **completeness score** (0 to 100%) shows what is missing and its weight.

| # | Step | Fields (from the proposal) |
|---|---|---|
| 1 | **Basics** | Project name, property type (Plotted / Farm house / Residential / Commercial / Mixed-use), city, locality, full address, map pin, short description, project stage (Pre-launch / Under construction / Ready to move) |
| 2 | **Size and layout** | Project size (acres), number of plots, open area %, number of phases, layout plan upload (image/PDF) |
| 3 | **Plots and units** | Inventory table: plot no., size (sq ft), dimensions (e.g. 20x50), facing, corner flag, road width, price or rate, status. For built projects: unit type, constructed/built-up area. Three ways to fill: **manual rows, Excel/CSV bulk upload (template provided), or "generate series"** (e.g. plots 1 to 120 at 1200 sq ft) |
| 4 | **Legal and approvals** | RERA number + validity, TNCP/DTCP number + validity, municipal approval, land use, title status, bank-loan approvals (multi-select banks), supporting PDFs. Each approval has an **expiry date** (drives auto-pause) |
| 5 | **Timeline and status** | Start date, completion date, % completed, possession status |
| 6 | **Pricing** | Price per sq ft, min/max budget (auto-computed from plots, overridable), token amount, payment plan text, additional charges (registration, development, etc.), current offers |
| 7 | **Amenities** | Checklist with icons (park, gym, pool, walking track, mandir, community hall, security, water, drainage, street lights, EV charging...), road width, water source, power |
| 8 | **Media** | Cover photo, gallery (limit per plan), tags (aerial, entrance, layout, amenities), video (YouTube link or upload by plan), brochure PDF, 360° tour link (Premier), progress updates later |
| 9 | **Contact** | Site address, site-visit contact name/phone, WhatsApp, public phone vs masked ("Contact via RKB"), visiting hours |
| 10 | **Review and submit** | Checklist, errors list, **"Preview as buyer"**, plan-limit check, Submit for verification |

**Excel bulk upload flow:** download template → fill → upload → server parses and validates row by row → shows a preview table with row-level errors (duplicate plot number, bad size, unknown facing) → builder fixes or re-uploads → confirm import. Imports are transactional.

**Re-use:** "Duplicate project" and "copy details from previous project" to speed up builders with many projects.

**Self-service after go-live:** change a plot status (Available / Booked / Sold) in one tap; bulk-mark selected plots; every change is logged in an audit trail so disputes can be resolved.

### 5.7 Project states

```
DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED ↔ (builder fixes)
                          ↓
                       APPROVED/LIVE → PAUSED (approval expired or subscription lapsed) → LIVE
                          ↓
                       ARCHIVED / SOLD_OUT
```

- Material edits to a live project (RERA number, approvals, price band) re-enter review; cosmetic edits (photos, description) publish instantly.
- A nightly job pauses any project whose RERA/TNCP/municipal approval has expired, and notifies the builder 30/7/1 days before ("Expired approvals paused", page 3).
- If a subscription lapses, listings **stay live until the paid month ends** (per the proposal), then move to PAUSED. Data is never deleted.

### 5.8 Guardrails and trust
- Server-side validation of every field; file type and size limits; virus scan hook on uploads.
- Prohibited-content checks (no phone numbers in descriptions to avoid disintermediation of alerts, optional).
- Duplicate detection: same RERA number, same name+locality, or near-identical coordinates.
- "Verified Builder" badge appears only when KYC is approved. "RERA verified" is a separate project-level badge.

---

## 6. Feature modules (all items from the proposal)

| Module | Details | Plan gating |
|---|---|---|
| Project showcase | Photos, video, brochure, layout, map pin, approvals | Photos: 15 / 40 / more; video: Growth+; 360° tour: Premier |
| Live plot inventory | Plot-wise size, facing, price; A/B/S status; Excel upload | All plans |
| Interactive layout map | Builder uploads layout image, then **draws a polygon per plot** in an editor; buyer sees clickable coloured plots (SVG overlay) | Growth+ |
| Lead dashboard | Inbox with status pipeline (New → Contacted → Site visit → Negotiation → Booked → Lost), notes, follow-up reminders, assign to team member, export CSV | Basic (Starter), Full (Growth+) |
| Alerts | Instant SMS/email/WhatsApp on new lead; daily digest; reminder alerts | WhatsApp alerts all plans |
| Online booking | Buyer picks plot → pays token → plot auto-reserved with a hold timer → receipt PDF | All plans |
| Analytics | Views, enquiries, site visits, funnel (view → enquiry → visit → booking), per-project and per-source; monthly report email | Advanced: Growth+; export: Premier |
| Reputation | Verified badge, ratings and reviews (only from verified enquirers/bookers), builder profile page | All plans |
| Featured / spotlight | "Featured days" quota (Growth: 2/month), homepage spotlight and priority search (Premier) | Growth / Premier |
| Team users | Invite by mobile/email, roles | 3 / 10 |
| Account manager | Support ticket + contact card | Premier |

A single `PLAN_FEATURES` config maps each plan to limits and flags (`maxProjects`, `maxPhotos`, `teamUsers`, `layoutMap`, ...), and **one helper** (`entitlements(builder).can('layoutMap')`) is used by both UI and API. Never scatter plan checks.

---

## 7. Booking and payments (the risky part)

Flow (matches page 3): **pick plot → pay token → plot auto-reserved → agreement signed (offline) → sale deed registered (offline).**

1. Buyer taps Book on an `AVAILABLE` plot and verifies via OTP.
2. Server creates a `Booking` in `PENDING` and **atomically sets the plot to `HELD`** (row lock; 15-minute hold) so two buyers cannot take the same plot.
3. Razorpay order is created with the **Route transfer** to the builder's linked account.
4. On the **webhook** `payment.captured` (never trust the browser redirect): booking → `CONFIRMED`, plot → `BOOKED`, receipt PDF generated, builder and buyer notified.
5. Timer expiry or failed payment releases the hold (job).
6. Builder marks the plot `SOLD` once the sale deed is done; the builder can also cancel/refund per the token's refund policy.
7. Idempotency keys on all payment calls; a reconciliation job compares our records to the gateway daily.

Items to settle with legal/finance **before** building this phase (see section 12): token amount cap, refund policy, who bears gateway fees, and how the platform is positioned (facilitator only).

**Payment is built last and behind a feature flag.** Until then the "Book" button degrades to "Request booking", which creates a high-priority lead.

---

## 8. Subscription billing

- Plans and prices are rows in the database (editable in admin), not hard-coded: Starter ₹2,999, Growth ₹7,999, Premier ₹19,999 per month, plus 18% GST.
- Annual = 10 × monthly price for 12 months.
- Razorpay Subscriptions, webhooks drive state: `TRIALING / ACTIVE / PAST_DUE / CANCELED`.
- Cancel any time; access lasts until `currentPeriodEnd`.
- GST-compliant invoice PDF per payment (GSTIN of builder, SAC code, CGST+SGST/IGST based on state).
- Founding-builder offer = coupon with city scope, usage cap and expiry.
- Upgrade/downgrade with proration; downgrade blocked if over limits (e.g. 5 projects → Starter) with a clear message.

---

## 9. Data model (Prisma, core entities)

```
User(id, mobile, email, name, role, consentVersion, createdAt)
Builder(id, ownerId, slug, companyName, type, pan, gstin, reraNo, about, logoUrl, coverUrl,
        yearEstablished, address, cityId, status[DRAFT|SUBMITTED|VERIFIED|REJECTED|SUSPENDED],
        verifiedAt, razorpayAccountId)
BuilderMember(builderId, userId, role)
BuilderDocument(id, builderId, kind, fileKey, status, reviewerId, reviewNote)
Plan(id, code, name, priceMonthly, limitsJson, featuresJson)
Subscription(id, builderId, planId, status, interval, currentPeriodEnd, razorpaySubId)
Invoice(id, subscriptionId, number, amount, gst, pdfKey)

City(id, name, state, slug) · Locality(id, cityId, name, slug, lat, lng)

Project(id, builderId, slug, name, type, stage, status, cityId, localityId, address, lat, lng,
        acres, totalPlots, openAreaPct, phases, description,
        priceFrom, priceTo, pricePerSqft, tokenAmount, paymentPlan, additionalCharges, offers,
        startDate, completionDate, percentComplete, landUse, titleStatus,
        completeness, publishedAt, featuredUntil, viewCount)
ProjectApproval(id, projectId, kind[RERA|TNCP|MUNICIPAL|BANK], number, validFrom, validTo, fileKey, verified)
ProjectAmenity(projectId, amenityCode) · Amenity(code, label, icon, group)
ProjectMedia(id, projectId, kind[PHOTO|VIDEO|BROCHURE|LAYOUT|TOUR], url, tag, sortOrder)
ProjectUpdate(id, projectId, text, mediaIds, createdAt)          // construction progress
ProjectSection(projectId, key, data json, savedAt)               // wizard drafts / autosave
Phase(id, projectId, name)
Plot(id, projectId, phaseId, number, sizeSqft, dimensions, facing, isCorner, roadWidthFt,
     price, ratePerSqft, status[AVAILABLE|HELD|BOOKED|SOLD], polygonJson)
PlotStatusLog(id, plotId, from, to, byUserId, at, reason)         // audit

Lead(id, projectId, builderId, buyerId, name, mobile, email, message, source, status,
     assignedTo, nextFollowUpAt, consentAt, createdAt)
LeadNote(id, leadId, authorId, text, createdAt)
SiteVisit(id, leadId, scheduledAt, status)
Shortlist(userId, projectId) · SavedSearch(userId, queryJson, alertFreq)
Booking(id, plotId, buyerId, builderId, tokenAmount, status, razorpayOrderId, razorpayPaymentId,
        holdExpiresAt, receiptKey, createdAt)
Review(id, projectId|builderId, buyerId, rating, text, status[PENDING|PUBLISHED|REJECTED])
Notification(id, userId, channel, template, payload, status, sentAt)
AnalyticsEvent(id, projectId, type[VIEW|CONTACT_CLICK|SHORTLIST|ENQUIRY|VISIT], sessionId, at)
AuditLog(id, actorId, action, entity, entityId, diffJson, at)
```

Indexes: `Project(cityId, type, status, priceFrom)`, `Plot(projectId, status)`, `Lead(builderId, status, createdAt)`, GIN on search vector, unique `slug`s, unique `(projectId, number)` for plots.

---

## 10. Architecture and folder layout

```
rkb/
├─ apps/web/                        # Next.js app
│  ├─ app/
│  │  ├─ (public)/                  # home, search, project, builder, pricing, for-builders
│  │  ├─ (auth)/                    # login, otp
│  │  ├─ (buyer)/account/           # shortlist, enquiries, bookings
│  │  ├─ (builder)/portal/          # onboarding, projects/[id]/wizard, leads, analytics, billing, team
│  │  ├─ (admin)/admin/             # verification queue, reviews, plans, users
│  │  └─ api/                       # webhooks (razorpay, whatsapp), uploads, cron
│  ├─ components/ (ui, cards, forms, maps, layout-editor)
│  ├─ lib/ (auth, rbac, entitlements, search, storage, notify, payments)
│  └─ styles/
├─ packages/db/                     # Prisma schema, migrations, seed
├─ packages/validation/             # Zod schemas shared client/server
├─ packages/config/                 # tokens, plans, amenity list
├─ docker-compose.yml               # postgres, minio, mailpit
└─ docs/
```

Principles: server components for read-heavy pages, server actions for forms, route handlers for webhooks and uploads, thin service layer (`lib/services/*`) holding business rules so UI and API cannot diverge.

**Search:** start with Postgres (filters + `tsvector` + `pg_trgm` for typos). Move to Meilisearch or Typesense only if ranking or scale needs it. Ranking = relevance × plan boost (Premier priority) × freshness × completeness, with a visible "Featured" label to stay honest.

**SEO:** server-rendered pages, clean URLs (`/plots-in-coimbatore`, `/project/green-valley-sulur`), JSON-LD, sitemap, canonical tags, OpenGraph images generated per project (great for WhatsApp sharing).

**Security:** OTP rate limiting + lockout, CSRF-safe server actions, signed uploads, row-level scoping, secrets via env, audit log, backups, dependency scanning.

**DPDP Act 2023:** explicit consent when a buyer's details are shared with a builder, privacy notice, data export/delete request flow, retention policy, no full Aadhaar storage.

---

## 11. Phased delivery

Estimates are for roughly one full-time developer working with Claude; adjust for team size. The order puts a **demo-able end-to-end slice** first.

| Phase | Scope | Exit criteria | Est. |
|---|---|---|---|
| **0. Foundation** | Repo, Next.js + Tailwind + shadcn, tokens, Docker (Postgres/MinIO), Prisma schema v1, seed data (cities, amenities, 3 builders, 8 projects, 400 plots), CI, OTP auth with dev-mode fixed OTP, RBAC skeleton | App boots, can sign in as buyer/builder/admin, seeded data renders | 1 wk |
| **1. Builder onboarding** | Registration, business profile, document upload, setup checklist, plan picker (no payment yet), admin verification queue (approve/reject/request changes) | A new builder can register, finish profile, upload docs; admin verifies; badge shows | 2 wk |
| **2. Project wizard** | All 10 steps with autosave, completeness score, plots table, **Excel import**, media upload, preview, submit/approve/publish states | Builder can create a full project from nothing and publish it after admin approval | 3 wk |
| **3. Public marketplace** | Home, search + filters + map toggle, project detail, builder profile, shortlist, SEO, PWA | A buyer can discover and evaluate any live project on a phone | 3 wk |
| **4. Leads and alerts** | Enquiry form with OTP + consent, lead inbox pipeline, notes, reminders, SMS/WhatsApp/email alerts, site-visit requests | Enquiry reaches builder in seconds with an alert | 2 wk |
| **5. Plans and billing** | Plans table, entitlements helper, Razorpay Subscriptions, GST invoices, coupons, limits enforcement, lapse behaviour | Builder pays, limits apply, cancellation works | 1.5 wk |
| **6. Online booking** | Plot hold, Razorpay Route token payment, webhook, receipt, refunds, reconciliation, feature-flagged | Test-mode end-to-end booking with no double-booking under concurrency test | 2 wk |
| **7. Analytics, reviews, layout editor** | Event tracking, dashboards, monthly report, ratings/reviews with moderation, **polygon plot-map editor** and interactive viewer, progress updates | Growth/Premier features complete | 3 wk |
| **8. Hardening and launch** | Load and security testing, accessibility pass, legal pages, admin tools, monitoring (Sentry, uptime), backups, content seeding for the launch city, founding-builder campaign | Production go-live in one city | 2 wk |

Total: roughly **19 to 20 weeks** sequentially. A usable **MVP (phases 0 to 4) is about 11 weeks** and already delivers the proposal's headline promise: verified builders, project pages, live inventory, and leads.

---

## 12. Risks and things the proposal glosses over

1. **"0% commission" vs payment costs.** Gateway fees (~2% plus GST) apply to token payments. Decide who pays (builder, buyer, or RKB) and say so clearly in the terms.
2. **Token money and RERA.** Advances before a registered agreement are capped by RERA (10% of cost in general). Set a token cap per project, define the refund/cancellation policy, and get legal review. The platform must be clearly a facilitator, not the seller.
3. **Settlement direct to the builder.** Needs Razorpay Route (or equivalent) with each builder KYC'd as a linked account. Approval and onboarding time at the gateway is outside our control, so start the gateway application early.
4. **"Verified" is a legal claim.** Define exactly what was checked and when, show "Verified on {date}", and have an unverification process. RERA data has no stable API for most states, so verification is manual at first.
5. **Cold start.** A marketplace with no listings is useless. Plan to onboard the first 20 to 30 builders by hand (the proposal's "we set up your first project free" is the right move) and pre-load launch-city content.
6. **Fake or stale inventory.** Stale "Available" plots destroy buyer trust. Send builders a monthly "confirm your inventory" nudge, show "Updated 2 days ago" on each project, and demote stale listings.
7. **Lead leakage / disintermediation.** Contact numbers shown openly mean RKB cannot measure leads. Use "Contact Builder" gated by OTP so every lead is logged and consented.
8. **Reviews can be gamed.** Only allow reviews from buyers with a logged enquiry/visit/booking, moderate them, and let builders respond.
9. **GST and invoicing.** Subscriptions need compliant invoices; confirm the registered entity and SAC code with your CA.
10. **Proposal inconsistencies to tidy:** "Online plot booking" is listed under Starter but the layout map is Growth+. This plan treats the plot table booking as all-plans and the visual map as Growth+. The contact block in the PDF still has placeholders (`[Your company name]`).

---

## 13. Testing and quality

- **Unit:** Zod schemas, entitlements, pricing/GST, plot-status state machine, Excel parser.
- **Integration:** server actions and services against a throwaway Postgres.
- **Concurrency:** two simultaneous bookings of one plot, exactly one wins.
- **E2E (Playwright):** builder registers → completes wizard → admin approves → buyer finds project → enquires → builder sees the lead. Run on mobile and desktop viewports.
- **Visual/a11y:** axe checks in CI; Lighthouse budget for home and project pages.
- **Payment sandbox suite:** success, failure, timeout, duplicate webhook, refund.

---

## 14. Decisions needed from you

1. **Launch region and language.** The proposal mentions TNCP, which suggests Tamil Nadu. Which city first, and do you want Tamil/Hindi in v1?
2. **Stack.** Are you happy with Next.js + Postgres + Prisma (section 2), or do you have a preference or existing team skills elsewhere?
3. **Scope of first build.** I recommend phases 0 to 4 (the MVP, with payments stubbed) first. OK?
4. **Free setup mode.** Should builders be able to fill everything out *before* paying (my recommendation), or pay before they can start?
5. **Brand.** Do you have a logo and exact brand colours? Otherwise I will use the palette from the PDF.
6. **Third-party accounts.** Do you already have, or can you get: a Razorpay account (with Route), an SMS/WhatsApp provider, a domain, and hosting?
7. **Legal.** Has the token/refund/terms model been reviewed by a lawyer? Phase 6 depends on it.

---

## 15. First steps once approved

1. Scaffold the monorepo, Docker Compose, Prisma schema v1 and seed.
2. Build the design system (tokens, buttons, cards, `ProjectCard`, `PlotStatusChip`, `Stepper`, `FileDropzone`).
3. Ship the builder register → profile → documents → admin verify slice.
4. Then the project wizard, then the public pages on top of the same data.
