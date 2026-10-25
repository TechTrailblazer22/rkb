# Phase 1 setup: turning on Auth0 login

The code is in place. Login only works once these values exist. Until then, public pages and `/api/health` keep working, and private pages (`/portal`, `/admin`, `/account`, ...) answer "Authentication is not configured" instead of crashing.

## 1. Put the Auth0 values in your local `.env`

Copy from `.env.example` and fill in (values come from Auth0 → Applications → RKB Platform → Settings):

```
AUTH0_DOMAIN="your-tenant.us.auth0.com"     # Domain, without https://
AUTH0_CLIENT_ID="..."
AUTH0_CLIENT_SECRET="..."                    # never share or commit this
AUTH0_SECRET="..."                           # run: openssl rand -hex 32
APP_BASE_URL="http://localhost:3000"
ADMIN_EMAILS="you@example.com"               # the email you will log in with
```

No `openssl` on Windows? Use PowerShell: `-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })`

Also run `npm run db:migrate` once so migration `0002_auth_builders` is applied to your Neon database.

## 2. Auth0 dashboard

- **Callback / Logout / Web Origin URLs** must include `http://localhost:3000` (and your Render URL once deployed). See `SETUP-PHASE-0.md` step 5.
- **Google login** (optional but recommended): Authentication → Social → Create Connection → Google. Auth0's built-in development keys work for testing. For production, add your own Google OAuth client. Then, in your application's **Connections** tab, make sure **Google** and **Username-Password-Authentication** are switched on.
- **Email verification**: email/password signups get a verification email. Until they click the link, the app shows "Please verify your email" and creates no account. Google logins are already verified.

## 3. Render

Open the service → **Environment** and set:

| Key | Value |
|---|---|
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | from Auth0 |
| `ADMIN_EMAILS` | comma separated admin emails |
| `AUTH0_SECRET` | created automatically by the blueprint (`generateValue`) |

`APP_BASE_URL` is not needed on Render: the app uses Render's own `RENDER_EXTERNAL_URL`. If you attach a custom domain later, set `APP_BASE_URL` to it.

Then add your Render URL to the three Auth0 URL fields (callback, logout, web origins) and **Save Changes**.

## 4. Try it (locally, then on Render)

1. Open `/` and click **Log in** and sign in with an email that is **not** in `ADMIN_EMAILS`.
   Expected: the **Welcome / terms** page, then `/account` (buyer).
2. Open `/portal` or `/admin`.
   Expected: you are sent back to `/account`.
3. On `/account` click **List your project**, then **Create my builder account**.
   Expected: you land on `/portal` showing a `DRAFT` builder.
4. Log out. Log in with the email in `ADMIN_EMAILS`, accept the terms.
   Expected: you land on `/admin` showing user and builder counts.
5. While logged out, open `/portal`.
   Expected: redirect to the Auth0 login page, and back to `/portal` afterwards.

## 5. Things to know

- **Same email, two sign-in methods.** Auth0 does not merge accounts. If someone registers with a password and later uses Google with the same email, they see "This email is already registered" and are asked to use the original method. Linking accounts safely is possible later but needs care.
- **Admins are bootstrapped from `ADMIN_EMAILS`** and only ever promoted by it. Removing an email from the variable does not demote an existing admin. An admin screen for that comes with the admin console.
- **Terms version.** `TERMS_VERSION` in `src/lib/legal.ts` is recorded with each consent. Change it when the terms change, and users are asked to accept again.
- **Roles live in our database, not in Auth0**, so nothing needs configuring in Auth0 for roles.

## 6. Email verification without a second login

**What the app does (already built).** After sign-up the user sees "Please verify your email". The main button, "I've verified my email, continue", signs them in silently using the Auth0 session from sign-up and takes them to their dashboard. They are not asked for the password again. "Use a different account" logs out instead.

**For people who click the link in the email** (Auth0's "email verified" page has a button back to the app), set the application's login URI. This only works on the live HTTPS site; Auth0 does not accept `localhost` here.

1. Auth0 → Applications → RKB Platform → Settings → **Application Login URI**
2. Set it to `https://<your-service>.onrender.com/login-continue` and **Save Changes**.

`/login-continue` starts a clean login that returns to `/dashboard`. If the user opened the email on another device or browser, there is no session to reuse and they log in once; Auth0 cannot avoid that.

Custom "Redirect To" URLs in the verification email template are not available on tenants created on or after 5 May 2026, and template editing needs your own email provider, so this setting is the supported route.

## 7. Password rules (minimum length)

The sign-up form and its password rules are hosted by Auth0, so this is set in the dashboard, not in code.

1. Authentication → **Database** → **Username-Password-Authentication**
2. **Authentication Methods** tab → **Password** → **Configure**
3. Expand **Composition**, set the **Strength** and a **minimum length of 10**.

Auth0's docs say a custom length is specified at the **Low** level (length only). Higher levels add rules such as upper and lower case letters, numbers, special characters and no more than two identical characters in a row. After saving, try signing up with a 9-character password (must be rejected) and a 10-character one (must be accepted) to confirm what your tenant enforces.
