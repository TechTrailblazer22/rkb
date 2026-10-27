# Online token booking (Phase 10)

A buyer holds an available plot for a few minutes, pays the project's token online, and the plot
becomes Booked. **It is off by default** and needs several things in place. Read the legal note first.

## Legal and business sign-off needed before switching it on

This software moves a buyer's money to a builder. Before `BOOKING_ENABLED=yes` in production, get
advice on at least: the maximum token (`BOOKING_MAX_TOKEN_RUPEES`, default 1,00,000), the refund
policy shown on the booking page, how a token relates to RERA's rules on advances and to the
builder's own agreement, the wording of the receipt, and your obligations (for example payment
aggregator rules) when money passes through Razorpay Route. Nothing in the code is legal advice.

## What has to be true for a plot to be bookable online (`lib/booking/config.ts`)

1. `BOOKING_ENABLED` is `yes`, `true` or `1`.
2. A payment gateway is configured (`BILLING_DRIVER`, see `docs/BILLING.md`).
3. The project is live and its company verified.
4. **The company has a payout account**, set by staff on the company's page in the admin console (a
   Razorpay Route linked account, `acc_...`). Without it the token would stay with RKB, so booking is
   not offered. The whole token is transferred to the company: RKB takes no commission.
5. The project's token amount is a whole number of rupees between `BOOKING_MIN_TOKEN_RUPEES`
   (default 500) and `BOOKING_MAX_TOKEN_RUPEES`.

When any of these fails, the plot table shows **Request booking** instead. That opens the enquiry
dialog with the plot filled in; the enquiry is saved as a *booking request*, which the company sees
flagged in its leads. The same page works with booking switched off entirely.

## The flow

1. **Hold.** `/account/book/[plotId]` shows the plot, the token, and plain notes about what the token
   is, how long the hold lasts, and when it is refunded. The buyer confirms name and mobile and ticks
   to agree. `holdPlot` locks the plot row (`SELECT ... FOR UPDATE`), frees any hold on it that has
   run out, and only if the plot is **Available** creates a booking and marks the plot **Held**
   (shown to other buyers as Booked). One live hold per buyer. If the gateway cannot be reached the
   hold is cancelled at once.
2. **Pay.** `/account/bookings/[id]` shows a countdown (display only; the server decides) and the
   pay button (Razorpay Checkout, or the labelled TEST button with the test gateway).
3. **Settle.** The browser's confirmation (checked against the gateway's signature) and the webhook
   both call `settleBooking`: idempotent, safe at the same moment, exactly the token amount or it is
   refused and recorded. Plot -> **Booked**, booking -> Paid, the buyer becomes a lead marked Booked
   (or the existing enquiry is moved to Booked), the buyer gets a receipt, the company is told.
4. **Release.** Holds that run out are released when the plot is next asked for and by the
   scheduler `/api/cron/bookings` (**every 5 minutes**).

## The rule about late money

A payment is honoured only if the gateway says the buyer **paid before the hold ended** (its own
timestamp, not when we heard) and the plot is still free for them. Otherwise the booking is marked
**refund due**, the plot goes back on sale, staff are emailed, and the buyer is told it will be
refunded in full. Money is never silently kept. Staff (or the company, for its own bookings) refund
from `/admin/billing` or `/portal/bookings`; the gateway refund also reverses the transfer to the
company. A refund puts the plot back on sale only if it is still Booked, never if the company has
since marked it Sold.

## Locks and ordering

Plot first, then booking, in every function that touches both (hold, settle, release, cancel,
refund), so they cannot deadlock. Tests include: many buyers racing for one plot (exactly one wins),
the expiry job racing a payment, the webhook and the return page together, and refunding twice.

## Daily check

`reconcileBookings` is read-only and reports: paid bookings whose plot is not Booked, plots shown as
held with no hold behind them, holds that ran out but were not released, and tokens waiting to be
refunded. `/api/cron/bookings` runs it each time, and emails staff once a day (03:00 UTC) if
anything is wrong.

## Scheduler

Add a second job at cron-job.org alongside the ones in `docs/LEADS.md` and `docs/BILLING.md`:
`https://<your domain>/api/cron/bookings` every 5 minutes, header `Authorization: Bearer <CRON_SECRET>`.
Without it holds still release lazily when a plot is next asked for, but a plot could look held for
longer than 15 minutes on pages nobody is booking from.

## Configuration

`BOOKING_ENABLED`, `BOOKING_HOLD_MINUTES` (5 to 60, default 15), `BOOKING_MIN_TOKEN_RUPEES`,
`BOOKING_MAX_TOKEN_RUPEES`. Anything unreadable falls back to the safe default.

## Tests

`src/lib/booking/booking.integration.test.ts` (config, holds, concurrency, settling, late and
out-of-order payments, refunds, the webhook, the daily check) and `tests/e2e/booking.mjs`.

## Not covered

- Real Razorpay Route was not used: the transfer and reversal calls follow its documented API and
  have only been run against the test gateway. Do a test-mode booking with real test keys first.
- Payouts, settlement timing and the company's own KYC are Razorpay's, not ours.
- A booking is a token paid to a builder, not a sale. Agreements, registration and any
  cancellation terms beyond the refund rules above are between buyer and builder.
