# Buyer and builder login: plan

## What was asked

The login should offer two options, **Buyer** and **Builder**. A person who logs in as a buyer sees
buyer pages; a person who logs in as a builder sees builder pages.

## How login works today (and why this needs design)

- The login form itself belongs to **Auth0** (Universal Login). We cannot put two buttons on it, and
  Auth0 only proves *who* someone is. It knows nothing about buyers and builders.
- Roles live in **our** database (`User.role`: `BUYER`, `BUILDER_OWNER`, `BUILDER_TEAM`, `ADMIN`). A
  new login creates a `BUYER`. A buyer becomes a builder owner only through the explicit
  `/start-listing` form. Admins come from the `ADMIN_EMAILS` list.
- So "log in as a buyer or a builder" cannot be a setting on the Auth0 form. It has to be a choice
  made **on our site, before** the person is sent to Auth0, and then checked **after** they come
  back.

## Decisions

1. **The choice is a door, not a permission.** The option someone picks (the *intent*) only decides
   where they are sent and what is explained to them. What they are allowed to see is always decided
   on the server from `User.role`, exactly as before. A crafted `?as=` can never give anyone access.
2. **One account has one role.** This is how the database already works. A builder who also wants to
   buy uses another email address. A buyer who becomes a builder converts the account, with a clear
   warning first. Their saved projects are kept but are not shown while the account is a builder
   account.
3. **A new `/login` page** with two cards, each offering *Log in* and *Create an account*. Every
   "Log in" button in the site points to it. Pages that need a particular kind of login (the builder
   portal, the buyer account) keep sending people straight to Auth0, because the page already says
   which door it is.
4. **Different pages, not just different colours.** Each role gets its own home, its own navigation
   and its own header, and the marketplace adapts to who is looking (see below).

## The two doors

| Door | Account type | What happens after Auth0 |
| --- | --- | --- |
| Buyer | buyer | `/account` (buyer home) |
| Buyer | builder | `/portal`, with a note: "You used the buyer option, but this is a builder account." |
| Buyer | admin | `/admin` |
| Builder | builder | `/portal` |
| Builder | buyer | `/start-listing` (explains and offers to turn the account into a builder account) |
| Builder | admin | `/admin` |
| none (a protected page, the email-verified link) | any | the home of their role, as before |

The decision is made in one pure function, `landingFor(role, intent)` in `src/lib/auth/intent.ts`,
which is unit tested. `/dashboard?as=buyer|builder` calls it. `/dashboard` is already the one place
that sends people to their area, so every login path ends there.

New accounts: the card's *Create an account* button adds Auth0's `screen_hint=signup`. A new person
is stored as a buyer by default; if they came through the builder door they land on `/start-listing`
and create their builder account there, as today.

## What each role sees

**Everyone (public site header)**

- Logged out: *Log in* (goes to `/login`) and *List your project*.
- Buyer: *Saved* and *My account*. No "List your project" button.
- Builder: *Builder portal*. No "Saved", no "List your project".
- Admin: *Admin console*.
- To know the role, the header asks `/api/me`, which now also returns `role`.

**Buyer**

- A buyer area at `/account` with its own tabs: *Overview* (greeting, number saved, the latest saved
  projects, search shortcut) and *Saved projects*.
- Heart buttons on project cards and project pages.
- Only buyers can save projects: the save API refuses other roles.

**Builder**

- The portal as it is (company profile, documents, plan, projects), plus a note when they arrived
  through the buyer door.
- No heart buttons on the marketplace (they are not shopping), and `/account/*` sends them to the
  portal.

**Admin**

- The console as it is. Hearts hidden, `/account/*` goes to `/admin`.

**The app shell** (the header inside `/account`, `/portal`, `/admin`) shows which kind of account
this is and the links that matter for it.

## Security

- The role is read from the database on the server for every protected page and action; the
  `?as=` value is checked against an allow-list (`buyer`, `builder`) and ignored otherwise.
- Redirects only go to fixed paths built in code, never to a value from the address bar.
- Converting a buyer to a builder stays a POST form handled by a server action that re-checks the
  role, so it cannot be triggered by a link.
- `/login` is not indexed and not in the sitemap.

## Not in this change

- One person holding both roles at once (would need a role set instead of a single role, and a
  switcher in the header).
- Choosing the role on Auth0's own sign-up form, or a role claim in the Auth0 token.
- Team members of a builder (`BUILDER_TEAM`) invited by an owner: they already use the builder
  door.

## Work list

1. `src/lib/auth/intent.ts` (+ tests): intent parsing, login URLs, `landingFor`.
2. `getSessionRole()` and `role` in `/api/me`.
3. `/login` page; `LOGIN_HREF` points to it.
4. `/dashboard` reads `?as=`.
5. Public header by role.
6. App shell by role; buyer area with tabs, overview and saved projects; buyer-only guards.
7. Hearts: hidden for builders and admins; save API refuses them.
8. Builder portal note; warning on `/start-listing`.
9. Browser tests (`tests/e2e/roles.mjs`) and updates to `logged-in-flows.mjs`.
10. Docs.

## Status: built

Everything in the work list above is done and checked by `tests/e2e/roles.mjs` (72 checks) and
`src/lib/auth/intent.test.ts`.

What you will notice:

- **`/login`** has two cards, "I'm a buyer" and "I'm a builder". Each has a log-in button and a
  "create an account" link. After pressing one, the person still sees Auth0's own form (that screen
  is the same for both), and then comes back to us.
- **The header** everywhere on the site now shows Log in and List your project to visitors; Saved
  and My account to buyers; Builder portal to builders; Admin console to the admin.
- **Buyers** get `/account` with two tabs (Overview, Saved projects). **Builders** get the portal.
  The strip at the top of those pages says "Buyer account", "Builder account" or "Admin".
- **Hearts** (save a project) appear for buyers and for logged-out visitors only.
- A builder who used the buyer door lands in the portal with a note explaining why.
- A buyer who used the builder door lands on the "create your builder account" page, which now warns
  that the account will become a builder account.

Things that did not change on purpose:

- Auth0's `Application Login URI` stays `https://<your site>/login-continue`. It still starts a
  clean login that ends at `/dashboard`.
- Pages that need a login (`/portal`, `/account`, `/admin`) still send anonymous visitors straight
  to Auth0 and bring them back to the page they asked for.
- **Auth0 setup needs no change.** The choice is made on our site and checked after Auth0 returns.

One side effect worth knowing: the header now asks the server for the role of a logged-in visitor
(`/api/me`), which reads one row from the database. This is also what creates the user row on the
very first visit after signing up, a moment earlier than before.
