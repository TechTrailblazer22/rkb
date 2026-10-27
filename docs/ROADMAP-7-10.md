# Plan for Phases 7 to 10, and the final audit

Written before starting, so every decision is on record. Status is kept at the end of each phase in
`docs/PHASES.md`.

## What was asked

1. Legal and approvals details, and the "at least 3 photos" rule, optional. *(Done: the wording says
   so everywhere and nothing blocks submitting or approving. Contradictory data, such as an approval
   that has already expired, still blocks, because the scheduler would pause the project at once.)*
2. **Phase 7** plan limits and entitlements (currently stubbed).
3. **Phase 8** subscription billing (the revenue).
4. **Later items:** analytics, reviews, a layout editor, online token booking.
5. Then verify the whole website like an expert researcher, look for bugs and fix them.

## Honest limits that shape the design

- **No payment account exists to test with.** Razorpay needs a business account and KYC. So payments
  go through a small *provider interface* with two drivers: `razorpay` (real REST calls and signed
  webhooks, written against Razorpay's documentation, exercised in tests with signed fake webhooks)
  and `test` (a built-in fake checkout, for development and the browser tests only, enabled only by
  an explicit `BILLING_DRIVER=test`, and labelled "Test payment, no money moves" on screen). With
  neither configured, the site says online payment is not enabled and an admin assigns plans by
  hand. Nothing ever pretends a payment happened.
- **Everything about money is stored in paise (integers)**, never floating point.
- **SMS/OTP, Razorpay Route payouts, a real PDF engine and Auth0 account deletion** need accounts or
  services that do not exist yet. Each is built to a clean seam and listed as a dependency.
- **The test database is the only real database used.** Production data is never touched by tests.

## Phase 7: plans and entitlements

**Model.** `Subscription` (one per company): plan, status (`ACTIVE`, `CANCELLED` meaning ends at the
period end, `EXPIRED`), source (`MANUAL`, `GATEWAY`, `COMP`), period start and end, interval
(monthly or annual), pending downgrade. `Invoice` and `InvoiceCounter` (numbers like
`RKB/2026-27/0001`). `TeamInvite`. `FeaturedDay`. `Project.pauseReason` so a project paused because
the plan lapsed resumes by itself when the plan returns, while one paused by an admin or for an
expired approval does not.

**One source of truth.** `entitlementsForBuilder(db, builderId)` reads the subscription and returns:
`canPublish`, `maxProjects`, `maxPhotosPerProject`, `video`, `teamSeats`, `leads` (`basic` or `full`),
`layoutMap`, `analytics` (`none`, `advanced`, `export`), `featuredDaysPerMonth`, `priorityListing`,
`homepageSpotlight`. The marketing table in `plans.ts` and these limits are tested against each
other so they cannot disagree.

**Enforced on the server, mirrored in the UI** (an upgrade prompt, never a silent hide):
creating a project over the limit; a photo over the cap; video; adding a team member over the
seats; follow-ups, site-visit management, CSV export and reminders on the basic lead dashboard;
the layout map; analytics; featuring a day.

**Publish gate.** A project goes live only if the company is verified **and** has an active plan.
Drafts need no plan. Existing verified companies are given a 90-day complimentary Growth plan by
the migration, so nothing already live breaks.

**Lapse.** Live projects stay live until the paid period ends, then (after a 3-day grace) are
paused with `pauseReason = PLAN_LAPSED`; data is kept; reminders go out 7, 3 and 1 days before; when
a plan becomes active again the lapse-paused projects go live again.

**Team.** An owner invites by email (a single-use link that expires in 7 days); the invited person
logs in as a builder and accepts; seat limits enforced. Team members work on projects, plots and
leads. Only the owner sees billing, the team page, the company profile and documents.

**Ranking.** Premier listings rank first, then days a company has featured, in the default
"Newest first" order only (price sorts stay exact), with a "Featured" label; Premier projects fill a
spotlight strip on the home page. Featured days are chosen by the builder up to the monthly allowance.

**Manual billing for now.** The admin assigns a plan, sets the period end and records a payment
reference; an invoice is made. This remains as the admin's tool after Phase 8.

## Phase 8: subscription billing

**Our database is the source of truth; the gateway only collects money.** This keeps proration,
invoices and entitlements testable without a gateway, and avoids depending on the gateway's own
subscription state machine. Consequence, stated plainly: renewals are **not auto-debited**; the
builder pays each period, with reminders and a pay link (Razorpay's recurring e-mandates can be added
later behind the same interface).

- `PaymentOrder` (purpose, amount, status, provider order id) and `PaymentEvent` (provider event id,
  unique, for idempotent webhooks).
- **Subscribe, renew, upgrade, downgrade, cancel.** Upgrade starts now and credits the unused part of
  the current period (`credit = total x days left / days in period`). Downgrade is scheduled for the
  period end and is **refused** while the company is over the new plan's limits, naming exactly what to
  reduce. Cancel keeps access to the period end.
- **Webhook** `/api/billing/webhook`: HMAC-SHA256 signature check, constant-time compare, idempotent by
  event id, safe to receive twice or out of order. The return page verifies the checkout signature as
  a faster path to the same idempotent settlement.
- **GST invoices.** CGST + SGST (9 + 9) when the builder's state equals ours, otherwise IGST 18;
  sequential numbers per financial year with no gaps under concurrency; the bill-to details are
  copied onto the invoice so later edits do not rewrite history; a printable page ("Save as PDF" from
  the browser). SAC code and our GSTIN are configuration; **confirm them with your CA before launch.**
- **Pages.** Builder: `/portal/billing` (plan, usage against limits, invoices, pay, change, cancel).
  Admin: `/admin/billing` (subscriptions, past due, revenue this month, assign a plan, record a manual
  payment, refund).
- **Scheduler** `/api/cron/billing`: renewal reminders, grace, expiry and pausing, resuming.

## Phase 9: analytics, reviews, layout map, progress

- **Analytics.** Counters, not raw rows: `ProjectDailyStat` keyed by project, day and source, updated
  with one atomic upsert, so the free database stays small. Events: page view (once per browser session
  per project), call/WhatsApp click, shortlist add, enquiry, visit request. Bots are ignored and the
  endpoint checks the request is from our own pages. Builder page `/portal/analytics`: totals, a
  30-day chart, per-project table, the funnel (views, enquiries, visits, booked) and sources;
  CSV export on Premier; a monthly performance email. No personal data is stored.
- **Reviews.** Only a buyer with an enquiry to that company can review it, once per company; rating
  1 to 5 and a short text; held for the admin to publish or reject (with a reason); the builder may
  reply once (editable); a "Verified enquirer" label; average and count shown on the builder and
  project pages. Plain text only, always escaped.
- **Layout map editor.** The builder draws a rectangle per plot over their layout image (or a plain
  canvas), assigns each to a plot, and moves, resizes or removes it; a table-based fallback assigns by
  keyboard. Buyers see a coloured, clickable map on the project page. Growth and above.
- **Progress updates.** The builder posts a dated note (with an optional photo); it appears on the
  project page, and people who saved the project are emailed (capped).

## Phase 10: online token booking, hardening, launch readiness

- **Booking.** Feature-flagged (`BOOKING_ENABLED`), off by default. When off, "Book" becomes
  "Request booking", a priority lead. When on: the buyer holds an available plot for 15 minutes
  (`SELECT ... FOR UPDATE` on the plot, so two buyers can never both hold it), pays the project's
  token through the provider, and a webhook turns the hold into a booking, the plot into Booked, and
  sends receipts. Expired holds are released by the scheduler (and on demand). A payment that arrives
  after the hold expired is flagged for refund, never silently kept. Refunds by the builder or
  admin. A daily reconciliation report flags payments without bookings and the reverse. The token
  amount has a configurable cap. Payouts to builders need Razorpay Route (a linked account id per
  builder, set by the admin); without it booking is not offered for that builder, because money would
  otherwise sit with RKB. **Legal sign-off on the token cap, refund policy and RERA advance rules is
  still needed before turning it on.**
- **A concurrency test:** parallel holds of one plot, exactly one wins.
- **Hardening.** Security headers and a Content-Security-Policy, rate limits on public write
  endpoints, branded error and not-found pages, DPDP self-service (download my data, delete my
  account, with leads anonymised not destroyed), dependency audit, secret and cron checks.
- **Operations.** A real backup and restore drill against a throwaway database, a load test with
  honest numbers, and a runbook for moving to paid hosting and a custom domain. (Buying the hosting
  and the domain is yours.)

## The final audit

After the phases, a systematic review: an inventory of every route, page and server action with the
check that protects it; the full browser suites on all of the above; input fuzzing of the public
endpoints; concurrency checks; Lighthouse; a dependency audit; a read-through of the diff for
anything that could leak data or double-charge; and a list of what remains.

## Order of work

1. Close Phase 6 (browser suite, regression runs).
2. Phase 7, with tests and a browser suite.
3. Phase 8, with tests and a browser suite.
4. Phase 9, in the order analytics, reviews, layout map, progress.
5. Phase 10, in the order booking, hardening, operations.
6. The audit, fixes, and a last full run.
