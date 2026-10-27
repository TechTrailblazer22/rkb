# Analytics, reviews, the layout map and construction progress (Phase 9)

Four features that help builders sell and buyers decide. Each follows the plan limits in
`docs/BILLING.md`. Tests: `src/lib/{analytics,reviews,layout-map,progress}/*.integration.test.ts` and
`tests/e2e/phase9.mjs`.

## Analytics

**Counters, not events.** `ProjectDailyStat` has one row per project, Indian calendar day, event and
traffic source, raised by a single atomic `INSERT ... ON CONFLICT DO UPDATE` (so any number of
simultaneous visits add up exactly). No visitor is identified and nothing personal is stored, so the
free database stays small and there is nothing to anonymise later.

| Event | Counted by |
|---|---|
| `VIEW`, `CALL`, `WHATSAPP` | the visitor's browser, through `POST /api/track` |
| `SHORTLIST` | the server, when a person newly saves a project (not on repeat presses) |
| `ENQUIRY`, `VISIT` | the server, when an enquiry (and a site-visit request) is created |

`/api/track` only counts. It answers 403 unless the `Origin` is this site (a script on another
website cannot inflate numbers), ignores crawlers and scripted clients (quietly, with the same 204),
drops events for projects that are not public, accepts only the three browser events, and limits each
address to 90 requests a minute (in memory, so per server process). The browser beacon
(`AnalyticsBeacon`) counts a view once per browser session per project and records only a coarse
source (direct, search, home, builder page, other website) from the referrer.

**Builder page** `/portal/analytics` (Growth and Premier; Starter sees an upgrade note): the last 30
days, tiles, a daily chart (plain SVG, with the same numbers in a table), the funnel (views,
enquiries, site visits, bookings), sources, and a table per project. **CSV export** is Premier only,
enforced by the route, with the same spreadsheet-formula protection as the lead export.
**Monthly email:** `/api/cron/performance` (run daily or monthly) sends last month's numbers to each
company whose plan has analytics, once per month (a `PerformanceReport` row is claimed before sending).

## Reviews

- **Who:** only a buyer who has sent that company an enquiry, once per company, and not a person in
  that company. The company must be verified.
- **Moderation:** a review is saved as *waiting*. Staff publish it, or reject it with a reason (at
  least 10 characters) that the reviewer sees and can act on. Editing a review, even a published one,
  sends it back to waiting, so everything public has been read by staff; the public pages are
  refreshed straight away when that happens.
- **Reply:** the owner or a manager answers a *published* review of their own company once, and can
  edit the answer.
- **Shown as:** "Asha K." (first name and last initial), with a "Verified enquirer" label, the star
  rating and the company's reply. The company's average and count appear on its page and on the
  project page. Text is stored as typed and always escaped when shown (a test stores markup and a
  browser test checks it is displayed as text).
- **Not done on purpose:** no review structured data (search engines disallow self-hosted reviews of
  a business for rich results), and no reviews of single projects.
- Staff page: `/admin/reviews`. Buyer page: `/account/reviews/[builderId]`, linked from the enquiry
  list. Company page: `/portal/reviews`.

## The layout map (Growth and Premier)

- Each plot gets a rectangle, stored as percentages of the map's width and height (so it looks right
  at any size). Saving replaces the whole map in one transaction; every rectangle is checked to lie
  inside the map, to be big enough to tap, to belong to a plot of this project and to appear once.
- **Editor** `/portal/projects/[id]/layout-map`: pick a plot, drag on the map to draw it; drag to
  move, drag the corner to resize, arrow keys to nudge, Delete to remove; a table sets exact numbers
  with no pointer at all. The background is the uploaded layout plan when that is an image (a PDF
  cannot be drawn over); otherwise a plain grid. Leaving with unsaved changes asks first.
- **Buyers** see the map on the project page, each plot coloured available, booked (including held)
  or sold, tappable or reachable by keyboard for its details. The plot table remains below, so the
  map is never the only way to read availability. The map is shown only while the company's plan
  includes it.

## Construction progress

- A dated note (5 to 500 characters) with an optional photo (JPG, PNG or WebP, checked by content,
  5 MB) on a **live** project; up to 5 a day. Shown on the project page, newest first.
- **Emails:** people who saved the project are told, one separate email each (nobody sees another's
  address), at most 200 per update and at most one email per person per project per day. The update
  is claimed before sending, so it never sends twice, and one bad address does not stop the rest. The
  email is sent after the response, and says why they are receiving it and how to stop (remove the
  project from saved).
- Posting is through `POST /api/builder/projects/[id]/progress` (the project is found through the
  signed-in company, never by id alone); deleting also removes the photo.

## Not covered

- Analytics cannot tell unique people apart (by design); "views" are browser sessions.
- The rate limit on the tracking endpoint is per process, which is right for one Render instance and
  would need a shared store if the site were run on several.
- Review authenticity is a human judgement by staff. A company could ask friends to enquire first;
  that is a policy matter for the moderation guidelines.
