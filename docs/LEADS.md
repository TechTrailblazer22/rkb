# Phase 6: enquiries, leads and reminders

## What a buyer and a builder get

- **Buyer:** a "Send enquiry" button on every project. It opens a short form (name, mobile, message,
  an optional plot and an optional site-visit date, and a consent tick). The enquiry is theirs to
  follow in **My enquiries**.
- **Builder:** the enquiry arrives in the **Leads** tab of the portal within a second, and as an
  email with a one-tap WhatsApp link. They move it along a pipeline (New, Contacted, Site visit,
  Negotiation, Booked, Lost), add notes, set a follow-up date, confirm site visits and export the lot
  as CSV.
- **Platform:** a scheduler URL sends follow-up reminders, a daily summary of new leads, and warns
  about, then pauses, approvals that have expired.

## Decisions

1. **A buyer must be logged in to enquire.** Auth0 has already verified their email address, which
   removes most spam, gives "My enquiries" an owner, and lets the consent be recorded against a real
   person. The button for a logged-out visitor leads to the buyer login and brings them back to the
   project with the form open. Builders and admins do not see the button.
2. **The mobile number is typed in, and is marked "not verified".** Verifying it needs an SMS
   provider and DLT registration in India, which takes days to weeks. The lead stores
   `mobileVerified = false`; the builder's screen says so. When a provider exists, only the
   verification step needs to be added.
3. **One open enquiry per buyer per project.** A second message on the same project while the first
   is still open is added to it as a message (and the builder is notified again), instead of creating
   a duplicate. A buyer can send at most 5 new enquiries in 24 hours. A hidden field catches simple
   bots. A CAPTCHA is not added: it needs a provider account, and the login already blocks anonymous
   bots.
4. **Consent is recorded.** The form requires an explicit tick that says the buyer's name, mobile and
   message are shared with the builder. The time and the version of the terms are stored with the
   lead.
5. **The pipeline is free-form.** A lead can be moved to any status, because real sales do not go in a
   straight line. Every move is kept as a timeline entry.
6. **Builders only ever see their own leads.** Every query is scoped by the company found through the
   logged-in user's membership, never by an id in the address. A lead id from another company is a 404.
7. **Buyers see a friendlier status**, not the builder's pipeline words: "Sent", "Builder is in
   touch", "Site visit planned", "In discussion", "Booked", "Closed".
8. **Reminders and digests are idempotent.** Each has a "last sent" marker, so running a job twice, or
   two overlapping runs, never sends the same email twice.
9. **The scheduler is an ordinary URL** (`/api/cron/...`) protected by a secret in the
   `Authorization` header. If the secret is not configured the endpoints answer 503, so they cannot
   be called by accident.
10. **CSV is made safe to open in Excel.** Cells that start with `=`, `+`, `-` or `@` are prefixed so a
    buyer cannot plant a spreadsheet formula in a builder's export.

## Not in this phase

- SMS or WhatsApp OTP for the mobile number (needs a provider).
- CAPTCHA.
- Assigning a lead to a team member (the team feature is not built yet).
- The weekly digest and the "confirm your inventory" nudge.
- Automatic WhatsApp or SMS alerts to the builder: the email carries a click-to-chat link instead.
- Lead analytics and the funnel (Phase 9).

## Work list

1. Schema: `Lead`, `LeadNote`, `SiteVisit`, reminder and warning markers (migration 0006).
2. Pure code: input checks, pipeline labels, CSV, with tests.
3. Service: create an enquiry, list and change leads, buyer's enquiries, with tests against Postgres.
4. Buyer side: the enquiry form on the project page, `/account/enquiries`, login that returns to the
   project.
5. Builder side: `/portal/leads` and a lead page, the new-lead email, dashboard tiles.
6. Scheduler: follow-up reminders, daily digest, approval expiry.
7. Browser tests (`tests/e2e/leads.mjs`) and docs.
