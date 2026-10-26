# Buyer and builder accounts on one email: plan (version 2)

This replaces the first version of this plan. The first version said "one account has one role".
The request changed that.

## What was asked

1. **One email can log in to both a buyer account and a builder account.**
2. **Separation.** Logged in as a buyer, you must not see any element made for builders. Logged in as
   a builder, you must not see any element made for buyers.
3. **Switching.** When you are logged in as a buyer, there is an option at the top to log in as a
   builder *without logging out*, and the other way round.

## Vocabulary

- **Account** = what the person has. Every non-admin email has a **buyer account** (it costs nothing
  and holds no data until it is used: saved projects). An email gets a **builder account** when it
  creates one on `/start-listing`. Both hang off the same login (the same `User` row).
- **Mode** = which of those accounts the person is using right now: `buyer`, `builder` (or `admin`
  for staff). It is chosen at the login door and changed with the switch at the top.

## How it works today, and what has to change

- `User.role` is a single value. A buyer who lists a project is *converted*: the role becomes
  `BUILDER_OWNER` and the buyer pages are closed to them. Every guard in the code reads `user.role`.
- Auth0 only proves who someone is, so the mode cannot live in Auth0. It has to be remembered by
  our site.

## Decisions

1. **Keep `User.role` and the builder membership as they are, and add a mode on top.**
   - Stored `role` still says what the person *can* be: `BUYER` (buyer only), `BUILDER_OWNER` or
     `BUILDER_TEAM` (has a builder account as well as the buyer one), `ADMIN` (staff).
   - `user.role` as seen by the code becomes **the role in the current mode**: in buyer mode it is
     `BUYER`, in builder mode it is the stored builder role. All existing guards
     (`requireUser({ roles })`, the upload routes, the save API) therefore keep working unchanged and
     are automatically right for whichever mode is active.
   - Creating a builder account no longer removes the buyer account: it only adds the builder one.
2. **The mode is remembered in a cookie (`rkb_mode`).** It is a *preference*, never a permission:
   the server accepts it only if the person really has that account, otherwise it falls back to the
   default (builder for someone whose stored role is a builder role, buyer for everyone else). It is
   readable by the page script on purpose, so static pages can hide the right elements before they
   are painted. It is set when logging in through a door, when switching, and when creating a builder
   account, and cleared on log out.
3. **Separation has two layers.**
   - *Whole pages* belong to one side. In builder mode the buyer pages (`/`, `/projects…`,
     `/project/…`, `/builder/…`) redirect to the builder portal. In buyer mode the builder pages
     (`/for-builders`, `/pricing`) redirect to the home page. This is done in `proxy.ts`, before the
     page, so cached public pages stay cached. It only applies to logged-in visitors; anonymous
     visitors see everything.
   - *Single elements on shared pages* (nav links, footer links, a call-to-action band) carry
     `data-for="builder"` or `data-for="buyer"` and one CSS rule hides them in the other mode. The
     page script sets `data-mode` on `<html>` from the cookie before first paint, so nothing flashes.
   - Elements that are drawn by the logged-in header (Saved, My account, Builder portal, hearts) are
     simply not rendered in the wrong mode.
   - Pages that need a login keep checking the role on the server. Hiding is for sight; the server is
     the lock.
4. **The switch.** A button at the top of every page for logged-in people (public header, mobile menu
   and the account/portal bar):
   - In buyer mode: "Switch to builder account" if they have one, otherwise "Create a builder
     account" (which leads to `/start-listing`).
   - In builder mode: "Switch to buyer account".
   - It is a small form (a plain GET) that goes to `/switch`, which checks the person really has
     that account, sets the cookie and lands them on the home of that mode. No logout, no password.
5. **Deep links.** If someone in buyer mode opens a page of the builder portal (for example the link
   in an email from us), or the other way round, the proxy sends them through `/switch` with the full
   address, so they arrive on that very page. `/switch` checks they really have that account;
   without it they are sent to their own home, as before. (The proxy does this because only it sees
   the whole path; a layout only knows its own. `requireUser` does the same as a fallback.)
6. **The login page stays two options.** The buyer door always means buyer mode. The builder door
   means builder mode if they have a builder account, otherwise the "create your builder account"
   page. Either door works for the same email. There are no more "wrong door" notes, because there is
   no wrong door.
7. **Admins** stay a single mode (the console). Both doors lead there. They are not shown either
   side's marketing elements and cannot save projects.

## Which elements belong to which side

| Side | Elements |
| --- | --- |
| Builder (hidden in buyer mode) | "For builders" and "Pricing" in the header and footer; "List your project" buttons; the "You build the project, we bring the buyers" band on the home page; the "list my project" button on an empty marketplace; the whole `/for-builders` and `/pricing` pages; the builder card on the buyer's account page |
| Buyer (hidden in builder mode) | "Projects" in the header and footer; hearts and Save buttons; Saved and My account; the whole home page, search, city pages, project pages and public builder pages; the buyer account area |
| Neutral (always visible) | Log in page, terms, privacy, disclaimer, the logo, the mode switch, Log out |

The builder's own preview of how a project looks to buyers stays inside the portal. It is a builder
tool, not the public marketplace.

## What does not change

- Auth0 setup. The `Application Login URI` stays `https://<site>/login-continue`.
- Protected pages still send anonymous visitors straight to Auth0 and back.
- Saved projects belong to the person, not to a mode, so they are still there after switching.
- Builder data (company, projects, plots, documents) is untouched by switching.

## Security

- The cookie is validated against an allow-list and against the person's real accounts on every
  request that matters. A forged `rkb_mode=builder` does nothing for someone without a builder
  account, and `rkb_mode=admin` does nothing for a non-admin.
- Switching is a GET, so that the redirects it makes (to log in, to accept the terms) work without
  replaying a form post. It only changes a display preference the person is already entitled to, so
  a link on another site that flips someone's mode is a nuisance, not a way in.
- All redirects go to fixed paths or to a `next` value that passes the same-site check.
- `/switch` and `/dashboard` require a login; an anonymous call goes to the login first.

## Not in this change

- Letting an admin also hold buyer or builder accounts.
- Inviting team members (`BUILDER_TEAM`) to a builder; they already work in builder mode.
- Several builder companies per email.

## Work list

1. `src/lib/auth/mode.ts` (+ tests): modes, the cookie, role-for-mode, which paths belong to which side.
2. `AppUser` gets `mode`, `modes`, `canBuild`; `requireUser` / `getApiUser` apply the cookie.
3. Routes: `/dashboard` (sets the mode after login), `/switch` (switch), `/logout` (clears the cookie).
4. `/api/me` returns the mode and what the person can switch to.
5. `proxy.ts` redirects wrong-side pages for logged-in visitors.
6. Root layout script + one CSS rule; `data-for` on the shared elements.
7. Header, mobile menu and account/portal bar: per mode, with the switch.
8. `/start-listing` adds a builder account instead of converting; remove the "wrong door" notice.
9. Update copy on `/login` and `/start-listing`.
10. Tests: unit, a rewritten `tests/e2e/roles.mjs`, updates to the other suites.

## Status: built

All of the work list is done. It is checked by `src/lib/auth/mode.test.ts`, `intent.test.ts`,
`landing.test.ts` and by `tests/e2e/roles.mjs` (107 checks, against a real browser and database).

What you will notice:

- **One email, both accounts.** A buyer who presses "Create a builder account" at the top of the page
  gets a builder account on the same login, keeps their buyer account (and its saved projects), and
  from then on has a "Switch to builder account" / "Switch to buyer account" button at the top of
  every page. No logout, no password.
- **Buyer mode shows nothing for builders.** No "For builders", "Pricing" or "List your project"
  anywhere, no builder band on the home page, no builder portal link. `/for-builders` and `/pricing`
  go to the home page.
- **Builder mode shows nothing for buyers.** No "Projects", Saved, My account or hearts. The home
  page, search, project pages and public builder pages go to the portal.
- **A visitor who is not logged in sees everything**, as before.
- The cookie that remembers the account is `rkb_mode`. Logging out (the Log out links now go to
  `/logout`) forgets it.

What to know:

- The two accounts share one login but are separate in what they hold: saved projects belong to the
  buyer account, companies, projects and plots to the builder account. Switching never changes data.
- The builder's preview of how a project looks to buyers stays inside the portal.
- Hiding on shared pages is done in the browser, before the first paint (so cached public pages stay
  cached and nothing flashes). Whole pages of the other side are blocked by the proxy, and every
  private page still checks the account on the server. Treat the hiding as presentation and the
  server checks as the lock.
- For someone whose session had already started before this change and who has no cookie yet, the
  header fills it in on the first page they open, so the very first public page may still show both
  sides.
