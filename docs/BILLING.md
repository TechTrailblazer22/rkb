# Plans, billing and the team (Phases 7 and 8)

How a company gets a plan, what the plan allows, how it pays, and what happens when it does not.
Read this before changing any of it. The design reasons are in `docs/ROADMAP-7-10.md`.

## The one rule

**Our database says who is on which plan until when. The payment gateway only collects money.**
A plan is never read from the gateway. This is what makes every rule below testable without a
gateway, and why a gateway outage can never take a company's plan away.

## What a plan allows

`src/lib/entitlements.ts` is the only place limits are written down. Every gate in the product reads
`ctx.entitlements` (portal pages) or `entitlementsForBuilder(db, builderId)` (actions, routes, jobs),
never the plan's name. `src/lib/plans.ts` holds the marketing copy, and a test
(`entitlements.test.ts`) fails if the two disagree.

| | Starter | Growth | Premier |
|---|---|---|---|
| Projects | 2 | 6 | unlimited |
| Photos per project | 15 | 40 | 40 |
| Video / 360° tour link | no / no | yes / no | yes / yes |
| Team seats (owner included) | 1 | 3 | 10 |
| Leads | basic | full | full |
| Featured days a month | 0 | 2 | priority listing instead |
| Homepage spotlight | no | no | yes |

- **Basic leads:** see leads, change status, add notes. **Full** adds follow-up dates and their email
  reminders, site-visit tracking and CSV export. Enforced in the pages, the server actions, the
  export route and the reminder job.
- **No plan (the free plan):** publishing never needs a plan. A company with none (never bought one,
  or its plan ended) can submit projects, staff can approve them, and they go live like anyone's.
  It gets the Starter-sized limits (2 projects, 15 photos, 1 seat, basic leads) and none of the
  extras. A plan adds room and features; it is never a condition for going live. Staff still review
  every project and the company must be verified. (Product note: because free equals Starter's size,
  Starter currently adds nothing over free. Decide what Starter should offer, or make the free tier
  smaller in `NO_PLAN` in `lib/entitlements.ts`.)
- **Grace:** a plan stays in force for `GRACE_DAYS` (3) after its paid period, so a late payment is
  not a cliff.

## The plan's life

```
free --pay--> ACTIVE --period ends--> (3 grace days) --> EXPIRED (free again) --pay--> ACTIVE
                   |  ^                                         |
                   |  +--- renew / upgrade ---------------------+
                   +--- downgrade or cancel: waits for the end of the period
```

- **Expiry** (`/api/cron/billing`, daily): ends the plan after the grace days and emails the owner.
  The company drops to the free plan: **its live projects stay live** and nothing is deleted or
  hidden; the extras switch off and it cannot add projects beyond the free limit (a company already
  over it keeps what it has).
- **Older data:** an earlier version paused projects when a plan ended. Migration `0012` put those
  back live, and `resumeLapsedProjects` still does so for any left. A project paused by staff
  (`ADMIN`) or by an expired approval (`APPROVAL_EXPIRED`) stays paused. Approval re-checks are in
  `lib/jobs/approval-expiry.ts`.
- **Reminders:** 7, 3 and 1 days before the end, once each (claimed before sending, so a second run
  sends nothing). A renewal starts them over.
- **Not auto-debited.** Renewals are paid by the company when it chooses; we remind it. Razorpay
  e-mandates could be added later behind `PaymentProvider`.

## Changing plans (`src/lib/billing/quote.ts`, pure and unit tested)

| From the current plan to... | What happens |
|---|---|
| nothing, or an ended plan | **Subscribe**: starts now, list price + GST |
| the same plan and period | **Renew**: extends from the end of the paid period (paying early loses no days); at most a year ahead |
| a higher plan, or monthly to annual of the same plan | **Upgrade**: starts now; credit = paid amount x days left / days in period (rounded down), taken off the new price |
| a lower plan, or annual to monthly | **Scheduled**: nothing to pay; takes effect when the period ends. **Refused** while the company is over the new plan's limits, with the exact list (`lib/billing/changes.ts`) |
| (after the paid period, in the grace days) anything | **Starts now**: no credit, nothing to wait for. This is how a scheduled change is paid for |

Cancel = "do not renew": the plan stays to the end of the period and the reminders say so. It can be
withdrawn.

A year costs ten months. Money is in paise (integers). GST is 18%: **CGST 9 + SGST 9** when the
company's state equals the supplier's, **IGST 18** otherwise or when its state is unknown to us
(the supplier's state is assumed). CGST + SGST always add up to the tax to the paisa.

## Paying (`src/lib/billing/payments.ts`)

1. The company picks a plan on `/portal/billing`. `createCheckout` makes a `PaymentOrder` with the
   exact amounts and asks the gateway for an order. An older unpaid order is set aside.
2. `/portal/billing/pay/[orderId]` shows the summary. With Razorpay the page opens Razorpay's own
   checkout (we never see card details); with the test gateway it shows a labelled TEST button.
3. The result reaches us two ways, **both safe to run, twice or at once**:
   - the browser calls `confirmCheckout`, believed only after the gateway's signature on
     `order_id|payment_id` verifies;
   - the gateway calls `/api/billing/webhook`.
4. `settleOrder` locks the order row, checks the amount equals the order's, then in **one
   transaction** sets the plan, writes the invoice and marks the order paid. A payment of another
   amount is refused, recorded in the audit log (`payment.amount_mismatch`) and flagged on the admin
   billing page. Money that arrives for an order that was set aside is still honoured.
5. `afterSettled` emails the receipt and refreshes the public pages (once, by the call that settled).

### The webhook (`src/lib/billing/webhook.ts`)

HMAC-SHA256 of the raw body with the webhook secret, compared in constant time, before anything is
read. 400 for a bad signature or body (not retried), 200 for handled, duplicates and events we do not
act on, 500 for a transient failure (the gateway retries). Handled events are remembered by the
gateway's event id (`PaymentEvent`) and, independently, settling is idempotent, so a replay under a
new event id changes nothing. Only ids and the event type are stored.

### Gateways (`src/lib/billing/provider.ts`)

| `BILLING_DRIVER` | |
|---|---|
| unset | Online payment is off. The billing page says so, buying is disabled, the webhook answers 503. Staff set plans by hand (below). |
| `razorpay` | Needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Webhook URL: `https://<your domain>/api/billing/webhook`, events `payment.captured`, `order.paid`, `payment.failed`. |
| `test` | No money moves; signs like the real one, so tests can play the gateway. Needs `BILLING_TEST_SECRET` (16+ characters). **Refused when `NODE_ENV=production`** unless `ALLOW_TEST_BILLING=yes`, so it cannot be left on by accident. The pay page carries a "TEST MODE" banner. |

A half-set configuration throws loudly rather than silently turning payments off.

## Invoices

- Numbers run `RKB/2026-27/0001`, per Indian financial year (April to March, by Indian time), with
  no gaps and no duplicates under concurrency (one atomic `INSERT ... ON CONFLICT ... RETURNING`).
- The bill-to details and the supplier's details are **copied onto the invoice**, so editing a
  company profile or the configuration later never rewrites an invoice already issued.
- `/portal/billing/invoices/[id]` (the owner, own company only) and `/admin/billing/invoices/[id]`
  print cleanly ("Print or save as PDF" from the browser; the site header is hidden in print).
- Configuration, **to confirm with your CA before launch**: `BILLING_SUPPLIER_NAME`,
  `BILLING_SUPPLIER_GSTIN`, `BILLING_SUPPLIER_STATE`, `BILLING_SUPPLIER_ADDRESS`, `INVOICE_SAC`
  (default 998439). Whether a refund needs a credit note, and the invoice's wording, are also for
  your CA. This software is not tax advice.
- A complimentary plan has no invoice.

## Staff

- **A company's page** (`/admin/builders/[id]`) has "Put this company on a plan": plan, billing,
  number of periods, paid (invoice, with the payment reference such as a bank UTR, amount before GST
  optional) or complimentary. This is also how a payment made outside the website is recorded.
- **`/admin/billing`:** plans in force, received this month, renewals to chase (in grace, and ended
  in the last 30 days), recent payments and invoices, and **refunds** (through the gateway when the
  payment was online; a reason is required; double refunds are impossible).

## The team

- The owner invites by email on `/portal/team` (Manager or Staff). A pending invitation holds a seat.
- The invitation is a single-use link (`/join/<token>`), 7 days, **only the SHA-256 of the token is
  stored**. It works only for the invited address and only for someone who is not staff and not
  already in a company, and the seat limit is **checked again when accepting**.
- Joining adds the company as a builder account on the same email; the buyer account is untouched
  and the mode switch works as before.
- **Owner only:** billing, team, company profile, documents, plan and review pages, their actions and
  the logo/document upload route. Others are sent back to `/portal`.
- **Manager:** projects, plots, leads, promote, and can submit, reopen or archive a project.
  **Staff:** projects, plots and leads, but not submit, reopen, archive or promote.
- Membership changes lock the company's row, so concurrent invitations cannot exceed the seats.

## Featured days and placement

- Growth books up to 2 days per calendar month (by the month of the featured day), up to 60 days
  ahead, on `/portal/promote`. A future day can be taken back; today's cannot.
- In the default "Newest first" order only: projects featured today first, then projects of a company
  on a plan with priority listing (Premier), then the rest, newest first. Price and availability
  sorts are exactly what the buyer chose. Anything with paid placement is labelled **Featured**.
- The home page shows up to three Premier projects in a labelled **sponsored** strip, rotated daily.
- All of it counts only while the plan is in force (period plus grace).

## Scheduler

`/api/cron/billing` (once a day, same secret and setup as the other jobs in `docs/LEADS.md`):
reminders, then expiry. It is idempotent and safe to run twice.

## Tests

- Unit: `entitlements.test.ts`, `billing/money.test.ts`, `billing/quote.test.ts`.
- Integration (`TEST_DATABASE_URL`): `billing/billing.integration.test.ts` (assigning, numbering,
  lifecycle), `billing/payments.integration.test.ts` (checkout, settling, webhook, refunds, plan
  changes), `team/team.integration.test.ts`, `featured/featured.integration.test.ts`,
  `projects/service.integration.test.ts` (the publish gate).
- Browser: `tests/e2e/plans.mjs` (plans, limits, team, featured, lifecycle) and
  `tests/e2e/billing.mjs` (checkout, invoices, upgrades, webhook, refunds). See `docs/TESTING.md`.

## Not covered

- No real Razorpay account was used. The Razorpay driver follows its documented API (Orders,
  Checkout signature, webhook signature, refunds) but has only been exercised against the test
  gateway. Run a test-mode payment with real test keys before launch.
- Auto-debit of renewals, credit notes and GST returns are out of scope.
