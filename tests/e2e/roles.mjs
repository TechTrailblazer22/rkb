// End-to-end check of buyer and builder accounts on one email, in a real browser, against a real
// Postgres. See docs/LOGIN-ROLES.md and docs/TESTING.md.
//
//   node tests/e2e/roles.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL>
//
// The server must run a production build with ADMIN_EMAILS=admin@test.example and an EMPTY
// database. Real Auth0 pages are not involved: sessions are signed with the SDK's testing helper,
// so what is tested is everything that happens *after* Auth0 sends the person back to us.
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";

const [, , projectDir, baseUrl, secret, databaseUrl] = process.argv;
const require = createRequire(path.join(projectDir, "package.json"));
const { chromium } = require("@playwright/test");
const { generateSessionCookie } = require("@auth0/nextjs-auth0/testing");
const { Client } = require("pg");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
};
const section = (title) => console.log(`\n--- ${title}`);

const people = {
  dual: {
    sub: "auth0|r-dual",
    email: "dual@test.example",
    email_verified: true,
    name: "Asha Both",
  },
  solo: { sub: "auth0|r-solo", email: "solo@test.example", email_verified: true, name: "Sam Solo" },
  admin: {
    sub: "auth0|r-admin",
    email: "admin@test.example",
    email_verified: true,
    name: "Root Admin",
  },
};

async function cookieFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const value = await generateSessionCookie(
    {
      user,
      tokenSet: { accessToken: "test-token", expiresAt: now + 3600 },
      internal: { sid: `sid-${user.sub}`, createdAt: now },
    },
    { secret },
  );
  return {
    name: "__session",
    value,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  };
}

const db = new Client({ connectionString: databaseUrl });
await db.connect();
const sql = async (text, params = []) => (await db.query(text, params)).rows;

const browser = await chromium.launch({ channel: "msedge" });
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
async function open(user, viewport = DESKTOP, extraCookies = []) {
  const context = await browser.newContext({ viewport });
  const cookies = [...extraCookies];
  if (user) cookies.unshift(await cookieFor(user));
  if (cookies.length) await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}
const modeCookie = (value) => ({ name: "rkb_mode", value, domain: "localhost", path: "/" });
const settle = async (page) => {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(250);
};
const where = (page) => new URL(page.url()).pathname + new URL(page.url()).search;
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const overflows = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const htmlMode = (page) => page.evaluate(() => document.documentElement.dataset.mode ?? null);
const cookieValue = async (context, name) =>
  (await context.cookies()).find((c) => c.name === name)?.value ?? null;

async function acceptTermsIfAsked(page) {
  if (new URL(page.url()).pathname === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await settle(page);
  }
}
/** Opens a route as a logged-in person (accepting the terms the first time) and reports where it ended up. */
async function go(page, route) {
  await page.goto(baseUrl + route);
  await acceptTermsIfAsked(page);
  await settle(page);
  // After accepting the terms the browser may still be following /dashboard or /switch to the
  // page they lead to: wait until the address has stopped changing.
  let last = "";
  let steady = 0;
  for (let i = 0; i < 40 && steady < 4; i++) {
    const now = where(page);
    steady = now === last ? steady + 1 : 0;
    last = now;
    await page.waitForTimeout(150);
  }
  await settle(page);
  return where(page);
}
/** Opens a page and waits until the header has learnt who is logged in. */
async function visit(page, route) {
  const me = page
    .waitForResponse((r) => r.url().includes("/api/me"), { timeout: 10000 })
    .catch(() => null);
  await page.goto(baseUrl + route);
  await me;
  await settle(page);
  return where(page);
}
const hearts = (page) => page.locator('[data-testid="shortlist-heart"]');
async function visitList(page) {
  const answered = page
    .waitForResponse((r) => r.url().includes("/api/shortlist"), { timeout: 10000 })
    .catch(() => null);
  await page.goto(baseUrl + "/projects");
  await answered;
  await settle(page);
}
const header = (page) => page.locator("header");
const headerLink = (page, name, exact = false) => header(page).getByRole("link", { name, exact });
const navLink = (page, name) =>
  page.locator('header nav[aria-label="Main"]').getByRole("link", { name });
const footerLink = (page, name) => page.locator("footer").getByRole("link", { name });
const switchButton = (page) => page.getByTestId("mode-switch");
const jsonHeaders = { "Content-Type": "application/json" };

// ---------------------------------------------------------------------------------------
// something public to look at
const builderRow = randomUUID().replace(/-/g, "");
await db.query(
  `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,'Anand Realty','VERIFIED','anand-realty',now(),now())`,
  [builderRow],
);
await db.query(
  `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES(gen_random_uuid()::text,$1,'GROWTH','COMP',now(),now()+interval '60 days',now())`,
  [builderRow],
);
const projectId = randomUUID().replace(/-/g, "");
await db.query(
  `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"publishedAt","updatedAt")
   VALUES($1,$2,'green-valley','LIVE','Green Valley Enclave','PLOTTED','READY_TO_MOVE','Hosur','Main Road',now(),now())`,
  [projectId, builderRow],
);
await db.query(
  `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt")
   SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),1000,1850000,'AVAILABLE',now() FROM generate_series(1,5) g`,
  [projectId],
);

// =======================================================================================
section("1. The login page, and what a visitor who is not logged in sees");

const anon = await open(null);
const response = await anon.page.goto(baseUrl + "/login");
await settle(anon.page);
check("/login loads for anyone", response?.status() === 200, String(response?.status()));
const doors = await anon.page
  .locator("[data-door]")
  .evaluateAll((els) => els.map((e) => e.dataset.door));
check(
  "it offers exactly two options: buyer and builder",
  JSON.stringify(doors) === JSON.stringify(["buyer", "builder"]),
  JSON.stringify(doors),
);
const hrefs = async (door) =>
  anon.page
    .locator(`[data-door="${door}"] a`)
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
const buyerLinks = await hrefs("buyer");
const builderLinks = await hrefs("builder");
check(
  "the buyer option returns through /dashboard?as=buyer",
  buyerLinks.includes("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuyer"),
  JSON.stringify(buyerLinks),
);
check(
  "the builder option returns through /dashboard?as=builder",
  builderLinks.includes("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuilder"),
  JSON.stringify(builderLinks),
);
check(
  "each option also offers sign-up",
  buyerLinks.some((h) => h.includes("screen_hint=signup") && h.includes("as%3Dbuyer")) &&
    builderLinks.some((h) => h.includes("screen_hint=signup") && h.includes("as%3Dbuilder")),
);
check(
  "the page says one email can be used for both",
  (await text(anon.page)).includes("use the same email for both"),
);
check(
  "it is not offered to search engines or in the sitemap",
  (await anon.page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") ===
    true && !(await (await fetch(baseUrl + "/sitemap.xml")).text()).includes("/login"),
);

await visit(anon.page, "/");
check(
  "a visitor sees the buyer side: Projects in the header",
  await navLink(anon.page, "Projects").isVisible(),
);
check(
  "and the builder side: For builders and Pricing",
  (await navLink(anon.page, "For builders").isVisible()) &&
    (await navLink(anon.page, "Pricing").isVisible()),
);
check(
  "and the builder band on the home page",
  await anon.page.locator('section[data-for="builder"]').first().isVisible(),
);
check(
  "Log in goes to /login",
  (await headerLink(anon.page, "Log in").first().getAttribute("href")) === "/login",
);
check(
  "a visitor can open the builder pages",
  (await fetch(baseUrl + "/for-builders")).status === 200 &&
    (await fetch(baseUrl + "/pricing")).status === 200,
);
await visitList(anon.page);
check(
  "a visitor sees hearts (pressing one asks them to log in)",
  (await hearts(anon.page).count()) > 0,
);
check("a visitor has no mode on the page", (await htmlMode(anon.page)) === null);

const keepAlive = await fetch(baseUrl + "/login-continue", { redirect: "manual" });
check(
  "Auth0's /login-continue link still works unchanged",
  keepAlive.status === 307 &&
    (keepAlive.headers.get("location") ?? "").includes("/auth/login?returnTo=%2Fdashboard"),
);

// a leftover cookie from a session that has ended must not hide anything
const stale = await open(null, DESKTOP, [modeCookie("builder")]);
const staleLanding = await visit(stale.page, "/");
check(
  "a leftover builder cookie without a session does not send a visitor away",
  staleLanding === "/",
  staleLanding,
);
check(
  "and the header forgets it",
  (await htmlMode(stale.page)) === null && (await cookieValue(stale.context, "rkb_mode")) === null,
);
check("so the buyer side is still shown", await navLink(stale.page, "Projects").isVisible());
await stale.context.close();

const phoneAnon = await open(null, PHONE);
await phoneAnon.page.goto(baseUrl + "/login");
await settle(phoneAnon.page);
check("the login page fits a phone screen", !(await overflows(phoneAnon.page)));
await phoneAnon.context.close();

// =======================================================================================
section("2. Someone who is only a buyer");

const solo = await open(people.solo);
const sp = solo.page;
check(
  "the buyer door puts them in the buyer account",
  (await go(sp, "/dashboard?as=buyer")) === "/account",
  where(sp),
);
check("and remembers it", (await cookieValue(solo.context, "rkb_mode")) === "buyer");
check(
  "the builder door offers to create a builder account",
  (await go(sp, "/dashboard?as=builder")) === "/start-listing",
);
check("and does not change the mode", (await cookieValue(solo.context, "rkb_mode")) === "buyer");
check("an unknown door is ignored", (await go(sp, "/dashboard?as=admin")) === "/account");
check(
  "so is a repeated one: the first wins",
  (await go(sp, "/dashboard?as=buyer&as=builder")) === "/account",
);

await visit(sp, "/account");
check("the page knows it is the buyer's", (await htmlMode(sp)) === "buyer");
check(
  "buyer pages say Buyer account",
  (await sp.getByTestId("account-kind").innerText()) === "Buyer account",
);
check(
  "the buyer area has its own tabs",
  (
    await sp.getByRole("navigation", { name: "Your account" }).getByRole("link").allInnerTexts()
  ).join("|") === "Overview|My enquiries|Saved projects|My data",
);
check(
  "the buyer's bar offers to create a builder account",
  (await switchButton(sp).innerText()).includes("Create a builder account"),
);
check(
  "the buyer's bar has no builder links",
  (await header(sp)
    .getByRole("link", { name: /portal|For builders|Pricing|List your project/i })
    .count()) === 0,
);
check(
  "the buyer's account page has no builder card",
  (await text(sp)).includes("Are you a builder") === false &&
    (await sp.getByRole("link", { name: "List your project" }).count()) === 0,
);

await visit(sp, "/");
check(
  "the buyer's header: Projects, Saved, My account",
  (await navLink(sp, "Projects").isVisible()) &&
    (await headerLink(sp, "Saved", true).count()) > 0 &&
    (await headerLink(sp, "My account").count()) > 0,
);
check(
  "no builder links in the header",
  !(await navLink(sp, "For builders").isVisible()) && !(await navLink(sp, "Pricing").isVisible()),
);
check(
  "none in the footer either",
  !(await footerLink(sp, "For builders").isVisible()) &&
    !(await footerLink(sp, "Pricing").isVisible()) &&
    (await footerLink(sp, "Projects").isVisible()),
);
check(
  "no List your project button anywhere on the home page",
  (await sp
    .getByRole("link", { name: "List your project" })
    .evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length)) === 0,
);
check(
  "the builder band is not shown",
  !(await sp.locator('section[data-for="builder"]').first().isVisible()),
);
check(
  "the builder pages are not available: /for-builders goes home",
  (await go(sp, "/for-builders")) === "/",
);
check("and /pricing too", (await go(sp, "/pricing")) === "/");

await visitList(sp);
check("buyers get hearts", (await hearts(sp).count()) > 0);
await hearts(sp).first().click();
await sp.waitForFunction(
  () => document.querySelector('[data-testid="shortlist-heart"][aria-pressed="true"]'),
  null,
  { timeout: 10000 },
);
const soloApi = await (await sp.request.get(baseUrl + "/api/shortlist")).json();
check("the save API lets a buyer save", soloApi.canSave === true && soloApi.ids.length === 1);

// forged cookies
const forged = await open(people.solo, DESKTOP, [modeCookie("builder")]);
check(
  "a forged builder cookie gives a buyer-only person nothing",
  (await go(forged.page, "/portal")) === "/account",
  where(forged.page),
);
const me = await (await forged.page.request.get(baseUrl + "/api/me")).json();
check(
  "the server still says buyer",
  me.mode === "buyer" && me.canBuild === false,
  JSON.stringify(me),
);
check("and puts the cookie right", (await cookieValue(forged.context, "rkb_mode")) === "buyer");
await forged.context.close();
const forgedAdmin = await open(people.solo, DESKTOP, [modeCookie("admin")]);
check(
  "a forged admin cookie does nothing",
  (await go(forgedAdmin.page, "/admin")) === "/account",
  where(forgedAdmin.page),
);
await forgedAdmin.context.close();

// =======================================================================================
section("3. One email, both accounts: the same person adds a builder account without logging out");

const dual = await open(people.dual);
const dp = dual.page;
await go(dp, "/dashboard?as=buyer");
await visitList(dp);
await hearts(dp).first().click();
await dp.waitForFunction(
  () => document.querySelector('[data-testid="shortlist-heart"][aria-pressed="true"]'),
  null,
  { timeout: 10000 },
);
await visit(dp, "/");
check(
  "in buyer mode the header offers the builder account",
  (await switchButton(dp).first().innerText()).includes("Create a builder account"),
);
await switchButton(dp).first().click();
await dp.waitForURL(/\/start-listing/);
await settle(dp);
check("it opens the page that creates a builder account", where(dp) === "/start-listing");
check(
  "which says the buyer account stays as it is",
  (await dp.getByTestId("both-accounts-note").innerText()).includes("buyer account stays as it is"),
);
check(
  "nothing is created just by looking",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "BuilderMember" bm JOIN "User" u ON u.id = bm."userId" WHERE u.email = 'dual@test.example'`,
    )
  )[0].n === 0,
);
await dp.getByRole("button", { name: "Create my builder account" }).click();
await dp.waitForURL(/\/portal$/);
await settle(dp);
check("creating it lands in the builder portal", where(dp) === "/portal");
check(
  "in builder mode",
  (await cookieValue(dual.context, "rkb_mode")) === "builder" && (await htmlMode(dp)) === "builder",
);
check(
  "the stored account records both",
  (await sql(`SELECT role FROM "User" WHERE email = 'dual@test.example'`))[0].role ===
    "BUILDER_OWNER",
);
check(
  "still the same login: one user for this email",
  (await sql(`SELECT count(*)::int AS n FROM "User" WHERE email = 'dual@test.example'`))[0].n === 1,
);

// ---- builder mode
section("4. In builder mode nothing made for buyers is shown");
check(
  "the portal says Builder account",
  (await dp.getByTestId("account-kind").innerText()) === "Builder account",
);
check(
  "the builder bar offers the way back",
  (await switchButton(dp).innerText()).includes("Switch to buyer account"),
);
check(
  "the builder bar has no buyer links",
  (await header(dp)
    .getByRole("link", { name: /Saved|My account|Browse projects|Marketplace|Projects$/ })
    .count()) === 0,
);
check(
  "the portal has the builder's own tabs",
  (await dp.getByRole("link", { name: "Company profile" }).count()) > 0,
);

check("the home page is a buyer page: it goes to the portal", (await go(dp, "/")) === "/portal");
check("search too", (await go(dp, "/projects")) === "/portal");
check("a city page", (await go(dp, "/projects/hosur")) === "/portal");
check("a project page", (await go(dp, "/project/green-valley")) === "/portal");
check("a public builder page", (await go(dp, "/builder/anand-realty")) === "/portal");
check(
  "the builder pages are open: /for-builders",
  (await go(dp, "/for-builders")) === "/for-builders",
);
await visit(dp, "/pricing");
check("and /pricing", where(dp) === "/pricing");
check(
  "its header: Builder portal and the way back, no buyer links",
  (await headerLink(dp, "Builder portal").count()) > 0 &&
    (await headerLink(dp, "Saved", true).count()) === 0 &&
    (await headerLink(dp, "My account").count()) === 0,
);
check(
  "the nav shows For builders and Pricing but not Projects",
  (await navLink(dp, "For builders").isVisible()) &&
    (await navLink(dp, "Pricing").isVisible()) &&
    !(await navLink(dp, "Projects").isVisible()),
);
check(
  "the footer too",
  (await footerLink(dp, "For builders").isVisible()) &&
    !(await footerLink(dp, "Projects").isVisible()),
);

const dualBuilderApi = await (await dp.request.get(baseUrl + "/api/shortlist")).json();
check(
  "in builder mode the save API says no saving",
  dualBuilderApi.canSave === false && dualBuilderApi.ids.length === 0,
  JSON.stringify(dualBuilderApi),
);
const builderPost = await dp.request.post(baseUrl + "/api/shortlist", {
  data: { projectId, saved: true },
  headers: jsonHeaders,
});
check("and refuses a save", builderPost.status() === 403, String(builderPost.status()));

// ---- switch back
section("5. Switching back to the buyer account without logging out");
await visit(dp, "/portal");
await switchButton(dp).click();
await dp.waitForURL(/\/account$/);
await settle(dp);
check(
  "the switch puts them in the buyer account",
  where(dp) === "/account" && (await cookieValue(dual.context, "rkb_mode")) === "buyer",
);
check(
  "still the same session: no login was needed",
  (await dp.getByTestId("account-kind").innerText()) === "Buyer account",
);
check(
  "their saved project is still there",
  (await dp.getByTestId("saved-count").innerText()).includes("saved 1 project"),
  await dp.getByTestId("saved-count").innerText(),
);
check(
  "the bar now offers the builder account they have",
  (await switchButton(dp).innerText()).includes("Switch to builder account"),
);
check(
  "and no builder links",
  (await header(dp)
    .getByRole("link", { name: /portal|For builders|Pricing|List your project/i })
    .count()) === 0,
);
await visit(dp, "/");
check(
  "the buyer side is back",
  (await navLink(dp, "Projects").isVisible()) &&
    !(await navLink(dp, "For builders").isVisible()) &&
    !(await footerLink(dp, "Pricing").isVisible()),
);
await visitList(dp);
check(
  "hearts are back, with the saved one filled",
  (await hearts(dp).count()) > 0 &&
    (await dp.locator('[data-testid="shortlist-heart"][aria-pressed="true"]').count()) === 1,
);
const dualBuyerApi = await (await dp.request.get(baseUrl + "/api/shortlist")).json();
check(
  "the same person can save again as a buyer",
  dualBuyerApi.canSave === true && dualBuyerApi.ids.length === 1,
);
check(
  "the builder's data was not touched by switching",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "Builder" b JOIN "BuilderMember" bm ON bm."builderId" = b.id JOIN "User" u ON u.id = bm."userId" WHERE u.email = 'dual@test.example'`,
    )
  )[0].n === 1,
);

// ---- the two ways of arriving, and deep links
section("6. Doors, deep links and logging out");
check("buyer door: the buyer account", (await go(dp, "/dashboard?as=buyer")) === "/account");
check(
  "builder door: the builder account, because they have one",
  (await go(dp, "/dashboard?as=builder")) === "/portal" &&
    (await cookieValue(dual.context, "rkb_mode")) === "builder",
);
check("no door: they stay in the account they were in", (await go(dp, "/dashboard")) === "/portal");
await go(dp, "/dashboard?as=buyer");
check(
  "a builder page opened while in buyer mode (an email link): goes there through the switch",
  (await go(dp, "/portal/projects")) === "/portal/projects" &&
    (await cookieValue(dual.context, "rkb_mode")) === "builder",
  where(dp),
);
check(
  "a buyer page opened while in builder mode: the same",
  (await go(dp, "/account/shortlist")) === "/account/shortlist" &&
    (await cookieValue(dual.context, "rkb_mode")) === "buyer",
  where(dp),
);
check(
  "/start-listing for someone who already has a builder account takes them to it",
  (await go(dp, "/start-listing")) === "/portal",
);
check(
  "a person with a builder account can only be in one place: no second company",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "BuilderMember" bm JOIN "User" u ON u.id = bm."userId" WHERE u.email = 'dual@test.example'`,
    )
  )[0].n === 1,
);

const bad = await fetch(baseUrl + "/switch?to=admin", { redirect: "manual" });
check(
  "/switch needs a login",
  bad.status === 307 && (bad.headers.get("location") ?? "").includes("/auth/login"),
  `${bad.status} ${bad.headers.get("location")}`,
);
const switchToAdmin = await dp.request.get(baseUrl + "/switch?to=admin", { maxRedirects: 0 });
check(
  "nobody can switch into the admin console",
  switchToAdmin.status() === 307,
  String(switchToAdmin.status()),
);
check(
  "it changed nothing",
  (await dp.request.get(baseUrl + "/api/me").then((r) => r.json())).mode === "builder",
);
const evilNext = await dp.request.get(
  baseUrl + "/switch?to=buyer&next=https%3A%2F%2Fevil.example",
  { maxRedirects: 0 },
);
check(
  "a switch never redirects to another site",
  (evilNext.headers()["location"] ?? "").startsWith("/") &&
    !(evilNext.headers()["location"] ?? "").includes("evil"),
  evilNext.headers()["location"],
);
await dp.request.get(baseUrl + "/switch?to=builder", { maxRedirects: 0 });

const logout = await fetch(baseUrl + "/logout", { redirect: "manual" });
check(
  "logging out sends them on to Auth0",
  logout.status === 307 && (logout.headers.get("location") ?? "") === "/auth/logout",
);
check(
  "and forgets the account that was in use",
  (logout.headers.get("set-cookie") ?? "").includes("rkb_mode=;") ||
    (logout.headers.get("set-cookie") ?? "").includes("Max-Age=0"),
  logout.headers.get("set-cookie"),
);

// ---- phone
const phoneDual = await open(people.dual, PHONE, [modeCookie("buyer")]);
await visit(phoneDual.page, "/");
await phoneDual.page.getByRole("button", { name: "Open menu" }).click();
check(
  "on a phone the menu has the switch",
  (await phoneDual.page.locator("#mobile-menu").getByTestId("mode-switch").innerText()).includes(
    "Switch to builder account",
  ),
);
check(
  "and no builder links in the menu",
  !(await phoneDual.page
    .locator("#mobile-menu")
    .getByRole("link", { name: "For builders" })
    .isVisible()),
);
await phoneDual.page.locator("#mobile-menu").getByTestId("mode-switch").click();
await phoneDual.page.waitForURL(/\/portal$/);
await settle(phoneDual.page);
check(
  "switching on a phone works, and the portal fits",
  where(phoneDual.page) === "/portal" && !(await overflows(phoneDual.page)),
);
await phoneDual.context.close();

// ---- no flash
const early = await open(people.dual, DESKTOP, [modeCookie("builder")]);
await early.page.goto(baseUrl + "/for-builders", { waitUntil: "domcontentloaded" });
check(
  "the mode is on the page before anything is painted (no flash of the other side)",
  (await htmlMode(early.page)) === "builder",
);
check(
  "and the buyer link is hidden at that moment",
  !(await navLink(early.page, "Projects").isVisible()),
);
await early.context.close();

// =======================================================================================
section("7. An admin");

const admin = await open(people.admin);
const ap = admin.page;
check("buyer door: the console", (await go(ap, "/dashboard?as=buyer")) === "/admin", where(ap));
check("builder door: the console", (await go(ap, "/dashboard?as=builder")) === "/admin");
check(
  "the admin shell says Admin and has no switch",
  (await ap.getByTestId("account-kind").innerText()) === "Admin" &&
    (await switchButton(ap).count()) === 0,
);
await visit(ap, "/");
check(
  "the admin's header: Admin console, no buyer or builder account links",
  (await headerLink(ap, "Admin console").count()) > 0 &&
    (await headerLink(ap, "Saved", true).count()) === 0 &&
    (await headerLink(ap, "Builder portal").count()) === 0 &&
    (await switchButton(ap).count()) === 0,
);
check(
  "the admin can see the marketplace and the builder pages",
  (await go(ap, "/projects")) === "/projects" && (await go(ap, "/pricing")) === "/pricing",
);
await visitList(ap);
check("but gets no hearts", (await hearts(ap).count()) === 0);
const adminPost = await ap.request.post(baseUrl + "/api/shortlist", {
  data: { projectId, saved: true },
  headers: jsonHeaders,
});
check("and cannot save", adminPost.status() === 403, String(adminPost.status()));
check(
  "the buyer and builder areas send the admin to the console",
  (await go(ap, "/account")) === "/admin" && (await go(ap, "/portal")) === "/admin",
);

// =======================================================================================
section("8. The door never grants anything");

const fresh = await open({
  sub: "auth0|r-fresh",
  email: "fresh@test.example",
  email_verified: true,
  name: "Fresh Person",
});
check(
  "a brand-new person through the builder door ends at the page that creates a builder account",
  (await go(fresh.page, "/dashboard?as=builder")) === "/start-listing",
);
check(
  "and is only a buyer until they press the button",
  (await sql(`SELECT role FROM "User" WHERE email = 'fresh@test.example'`))[0].role === "BUYER",
);
const anonDash = await fetch(baseUrl + "/dashboard?as=builder", { redirect: "manual" });
check(
  "logged out, /dashboard asks for a login first",
  anonDash.status === 307 && (anonDash.headers.get("location") ?? "").includes("/auth/login"),
);
const anonPost = await fetch(baseUrl + "/api/shortlist", {
  method: "POST",
  headers: jsonHeaders,
  body: JSON.stringify({ projectId, saved: true }),
});
check(
  "logged out, the save API says log in first",
  anonPost.status === 401,
  String(anonPost.status),
);

await browser.close();
await db.end();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
