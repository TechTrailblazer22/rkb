# Phase 0 setup checklist

The code is ready. These steps need your accounts, so they have to be done in each dashboard. Do them in order.

## 1. GitHub

1. Create a **private** repository named `rkb` (no README, no .gitignore, no license).
2. In the project folder:
   ```bash
   git add .
   git commit -m "Phase 0: scaffold, Prisma, health checks, Render blueprint"
   git remote add origin https://github.com/<your-username>/rkb.git
   git push -u origin main
   ```
3. Check the Actions tab: the CI workflow should go green.

## 2. Neon (database)

1. Sign up at neon.com and create a project. Choose the **Singapore** region (closest to India) if offered.
2. In the connection dialog, copy two strings:
   - **Pooled** (host contains `-pooler`) → this is `DATABASE_URL`
   - **Direct** (toggle "pooled connection" off) → this is `DIRECT_URL`
3. Put both in a local `.env`, then run `npm run db:migrate`. It should apply `0001_init`.
4. Run `npm run dev` and open http://localhost:3000/api/health/db. Expect `{"status":"ok","db":"up",...}`.

## 3. Render

1. Sign up at render.com and connect your GitHub account.
2. New → **Blueprint** → pick the `rkb` repo. Render reads `render.yaml`.
3. When asked for `DATABASE_URL` and `DIRECT_URL`, paste the Neon values from step 2.
4. Deploy. The build runs `npx prisma migrate deploy`, so the database is migrated automatically.
5. Open the `*.onrender.com` URL: you should see the RKB placeholder page, and `/api/health/db` should report `db: up`.
6. If the region `singapore` is not accepted, edit it in `render.yaml` (or in the dashboard) and redeploy.

## 4. UptimeRobot (keep the free service warm)

1. Create a free account and add an **HTTP(s)** monitor for `https://<your-service>.onrender.com/api/health`, interval **5 minutes**.
2. This avoids most cold starts. Note it uses most of the 750 free hours, which is why only one service is allowed.

## 5. Auth0 (wired up in Phase 1)

1. Create a tenant at auth0.com (pick a region close to India if offered).
2. Applications → Create → **Regular Web Application**.
3. Note the **Domain**, **Client ID** and **Client Secret**. Do not paste the secret into chat or commit it; it goes into Render and local `.env` in Phase 1.
4. Under Settings, add these URLs now (replace the Render host):
   - Allowed Callback URLs: `http://localhost:3000/auth/callback, https://<service>.onrender.com/auth/callback`
   - Allowed Logout URLs: `http://localhost:3000, https://<service>.onrender.com`
   - Allowed Web Origins: `http://localhost:3000, https://<service>.onrender.com`

## 6. Sentry (optional now)

Create a free project (Next.js). We add the SDK in a later phase; the DSN goes in as `SENTRY_DSN`.

## Phase 0 is done when

- [ ] A push to `main` redeploys on Render automatically
- [ ] The live URL shows the placeholder page
- [ ] `/api/health` returns 200 and `/api/health/db` returns `db: up`
- [ ] CI is green on GitHub
- [ ] UptimeRobot shows the service as up
- [ ] An Auth0 application exists with the callback URLs set
