// End-to-end check of the buyer / builder / admin experience, in a real browser, against a real
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
  buyer: {
    sub: "auth0|r-buyer",
    email: "rbuyer@test.example",
    email_verified: true,
    name: "Asha Buyer",
  },
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
async function open(user, viewport = DESKTOP) {
  const context = await browser.newContext({ viewport });
  if (user) await context.addCookies([await cookieFor(user)]);
  return { context, page: await context.newPage() };
}
const settle = async (page) => {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(250);
};
const where = (page) => new URL(page.url()).pathname + new URL(page.url()).search;
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const overflows = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

/** Opens a page and waits until the header has learnt who is logged in. */
async function visit(page, route) {
  const me = page
    .waitForResponse((r) => r.url().includes("/api/me"), { timeout: 10000 })
    .catch(() => null);
  await page.goto(baseUrl + route);
  await me;
  await settle(page);
}
async function acceptTermsIfAsked(page) {
  if (new URL(page.url()).pathname === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await settle(page);
  }
}
/** Goes to a route as a logged-in person, accepting the terms the first time, and reports where it ended up. */
async function go(page, route) {
  await page.goto(baseUrl + route);
  await acceptTermsIfAsked(page);
  await settle(page);
  return where(page);
}
const hearts = (page) => page.locator('[data-testid="shortlist-heart"]');
/** Opens the marketplace list and waits for the shortlist provider to have answered. */
async function visitList(page) {
  const answered = page
    .waitForResponse((r) => r.url().includes("/api/shortlist"), { timeout: 10000 })
    .catch(() => null);
  await page.goto(baseUrl + "/projects");
  await answered;
  await settle(page);
}

// ---------------------------------------------------------------------------------------
// something public to look at
const builderRow = randomUUID().replace(/-/g, "");
await db.query(
  `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,'Anand Realty','VERIFIED','anand-realty',now(),now())`,
  [builderRow],
);
const projectId = randomUUID().replace(/-/g, "");
await db.query(
  `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"publishedAt","updatedAt")
   VALUES($1,$2,'green-valley','LIVE','Green Valley Enclave','PLOTTED','READY_TO_MOVE','Hosur','Main Road',now(),now())`,
  [projectId, builderRow],
);
await db.query(
  `INSERT INTO "Plot"(id,"projectId",number,"sortKey",\"sizeSqft\",price,status,\"updatedAt\")
   SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),1000,1850000,'AVAILABLE',now() FROM generate_series(1,5) g`,
  [projectId],
);

// =======================================================================================
section("1. The login page offers two doors");

const anon = await open(null);
const response = await anon.page.goto(baseUrl + "/login");
await settle(anon.page);
check("/login loads for anyone", response?.status() === 200, String(response?.status()));
const doors = await anon.page
  .locator("[data-door]")
  .evaluateAll((els) => els.map((e) => e.dataset.door));
check(
  "it has exactly two options: buyer and builder",
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
  "the buyer option logs in and returns through /dashboard?as=buyer",
  buyerLinks.includes("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuyer"),
  JSON.stringify(buyerLinks),
);
check(
  "the builder option logs in and returns through /dashboard?as=builder",
  builderLinks.includes("/auth/login?returnTo=%2Fdashboard%3Fas%3Dbuilder"),
  JSON.stringify(builderLinks),
);
check(
  "each option also offers to create an account (Auth0's sign-up screen)",
  buyerLinks.some((h) => h.includes("screen_hint=signup") && h.includes("as%3Dbuyer")) &&
    builderLinks.some((h) => h.includes("screen_hint=signup") && h.includes("as%3Dbuilder")),
);
check(
  "the buyer card says what a buyer gets",
  (await anon.page.locator('[data-door="buyer"]').innerText()).includes("Save projects"),
);
check(
  "the builder card says what a builder gets",
  (await anon.page.locator('[data-door="builder"]').innerText()).includes("No commission"),
);
check(
  "the page is not offered to search engines",
  (await anon.page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") ===
    true,
);
const sitemap = await (await fetch(baseUrl + "/sitemap.xml")).text();
check("and it is not in the sitemap", !sitemap.includes("/login"));

await anon.page.goto(baseUrl + "/login?role=builder");
await settle(anon.page);
check(
  "?role=builder highlights the builder card",
  (await anon.page.locator('[data-door="builder"]').getAttribute("class"))?.includes(
    "border-teal-500",
  ) === true &&
    (await anon.page.locator('[data-door="buyer"]').getAttribute("class"))?.includes(
      "border-teal-500",
    ) === false,
);
await anon.page.goto(baseUrl + "/login?role=%3Cscript%3E");
await settle(anon.page);
check("a junk ?role= is ignored", (await anon.page.locator("[data-door].ring-2").count()) === 0);

await visit(anon.page, "/");
const headerLogin = anon.page.getByRole("link", { name: "Log in" }).first();
check(
  "the header's Log in goes to /login (not straight to Auth0)",
  (await headerLogin.getAttribute("href")) === "/login",
);
check(
  "List your project still goes straight to sign-up as a builder",
  (
    (await anon.page
      .getByRole("link", { name: "List your project" })
      .first()
      .getAttribute("href")) ?? ""
  ).includes("start-listing"),
);
await headerLogin.click();
await anon.page.waitForURL(/\/login$/);
check(
  "clicking Log in opens the two-option page",
  (await text(anon.page)).includes("I'm a buyer") &&
    (await text(anon.page)).includes("I'm a builder"),
);

const keepAlive = await fetch(baseUrl + "/login-continue", { redirect: "manual" });
check(
  "Auth0's /login-continue link (after email verification) still works unchanged",
  keepAlive.status === 307 &&
    (keepAlive.headers.get("location") ?? "").includes("/auth/login?returnTo=%2Fdashboard"),
  `${keepAlive.status} ${keepAlive.headers.get("location")}`,
);

await visitList(anon.page);
check(
  "logged-out visitors see hearts (pressing one asks them to log in)",
  (await hearts(anon.page).count()) > 0,
);

const phone = await open(null, PHONE);
await phone.page.goto(baseUrl + "/login");
await settle(phone.page);
check("the login page fits a phone screen", !(await overflows(phone.page)));
check("and both options are on it", (await phone.page.locator("[data-door]").count()) === 2);
await phone.context.close();

// =======================================================================================
section("2. A buyer");

const buyer = await open(people.buyer);
const bp = buyer.page;
check(
  "buyer door: /dashboard?as=buyer goes to the buyer home",
  (await go(bp, "/dashboard?as=buyer")) === "/account",
  where(bp),
);
check(
  "no door: /dashboard goes to the buyer home too",
  (await go(bp, "/dashboard")) === "/account",
);
check("an unknown door is ignored", (await go(bp, "/dashboard?as=admin")) === "/account");
check("so is script in the door", (await go(bp, "/dashboard?as=%3Cscript%3E")) === "/account");
check(
  "a second ?as= cannot sneak past: first value wins",
  (await go(bp, "/dashboard?as=buyer&as=builder")) === "/account",
);

await visit(bp, "/account");
check(
  "buyer pages say Buyer account",
  (await bp.getByTestId("account-kind").innerText()) === "Buyer account",
);
check(
  "buyer pages have their own tabs",
  (
    await bp.getByRole("navigation", { name: "Your account" }).getByRole("link").allInnerTexts()
  ).join("|") === "Overview|Saved projects",
);
check("and a greeting by name", (await text(bp)).includes("Welcome, Asha Buyer"));
check(
  "the buyer home has no builder tools",
  (await bp.getByRole("link", { name: "Company profile" }).count()) === 0,
);
check(
  "buyer header: Saved and My account, but no Builder portal and no List your project button",
  (await bp.locator("header").getByRole("link", { name: "Saved", exact: true }).count()) > 0 &&
    (await bp.locator("header").getByRole("link", { name: "My account" }).count()) > 0 &&
    (await bp.locator("header").getByRole("link", { name: "Builder portal" }).count()) === 0,
);

await visit(bp, "/");
check(
  "on the public site the buyer's header shows Saved and My account",
  (await bp.locator("header").getByRole("link", { name: "Saved", exact: true }).count()) > 0 &&
    (await bp.locator("header").getByRole("link", { name: "My account" }).count()) > 0 &&
    (await bp.locator("header").getByRole("link", { name: "Builder portal" }).count()) === 0 &&
    (await bp.locator("header").getByRole("link", { name: "List your project" }).count()) === 0 &&
    (await bp.locator("header").getByRole("link", { name: "Log in" }).count()) === 0,
);

await visitList(bp);
check("buyers get hearts on the marketplace", (await hearts(bp).count()) > 0);
await hearts(bp).first().click();
await bp.waitForFunction(
  () => document.querySelector('[data-testid="shortlist-heart"][aria-pressed="true"]'),
  null,
  { timeout: 10000 },
);
await bp.goto(baseUrl + "/account");
await settle(bp);
check(
  "saving shows up on the buyer home",
  (await bp.getByTestId("saved-count").innerText()).includes("saved 1 project"),
);
check(
  "with the project listed under Recently saved",
  (await text(bp)).includes("Recently saved") && (await text(bp)).includes("Green Valley Enclave"),
);
await bp.goto(baseUrl + "/account/shortlist");
await settle(bp);
check(
  "and on the Saved projects tab",
  (await bp.locator('[data-testid="listing-card"]').count()) === 1,
);

const buyerApi = await bp.request.get(baseUrl + "/api/shortlist");
const buyerList = await buyerApi.json();
check(
  "the save API tells a buyer they can save",
  buyerList.authenticated === true && buyerList.canSave === true && buyerList.ids.length === 1,
  JSON.stringify(buyerList),
);

// the builder door for a buyer
check(
  "builder door: a buyer is offered a builder account",
  (await go(bp, "/dashboard?as=builder")) === "/start-listing",
  where(bp),
);
check(
  "and is warned that the account will change",
  (await bp.getByTestId("role-switch-warning").innerText()).includes(
    "turns your account into a builder account",
  ),
);
check(
  "nothing was created just by looking",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "BuilderMember" bm JOIN "User" u ON u.id = bm."userId" WHERE u.email = 'rbuyer@test.example'`,
    )
  )[0].n === 0,
);

// =======================================================================================
section("3. The same person becomes a builder");

await bp.getByRole("button", { name: "Create my builder account" }).click();
await bp.waitForURL(/\/portal$/);
await settle(bp);
check("creating the builder account lands in the portal", where(bp) === "/portal");
check(
  "builder pages say Builder account",
  (await bp.getByTestId("account-kind").innerText()) === "Builder account",
);
check(
  "the portal has the builder's own tabs",
  (await bp.getByRole("link", { name: "Company profile" }).count()) > 0,
);
check(
  "the builder shell links to the portal and the marketplace, not to buyer pages",
  (await bp
    .getByRole("navigation", { name: "Account" })
    .getByRole("link", { name: "Portal" })
    .count()) === 1 &&
    (await bp
      .getByRole("navigation", { name: "Account" })
      .getByRole("link", { name: "Saved" })
      .count()) === 0,
);

check(
  "builder door: goes to the portal, no notice",
  (await go(bp, "/dashboard?as=builder")) === "/portal",
  where(bp),
);
check(
  "no notice is shown for the right door",
  (await bp.getByTestId("login-notice").count()) === 0,
);
check(
  "buyer door with a builder account: goes to the portal with a note",
  (await go(bp, "/dashboard?as=buyer")) === "/portal?notice=builder-account",
  where(bp),
);
check(
  "and the note explains why",
  (await bp.getByTestId("login-notice").innerText()).includes("This is a builder account") &&
    (await bp.getByTestId("login-notice").innerText()).includes("different email address"),
);
await bp.goto(baseUrl + "/portal?notice=%3Cscript%3Ealert(1)%3C/script%3E");
await settle(bp);
check("a made-up notice is not shown", (await bp.getByTestId("login-notice").count()) === 0);
check("no door: /dashboard goes to the portal", (await go(bp, "/dashboard")) === "/portal");

check("builders cannot open the buyer home", (await go(bp, "/account")) === "/portal");
check("or the saved projects page", (await go(bp, "/account/shortlist")) === "/portal");
check("or /start-listing again", (await go(bp, "/start-listing")) === "/portal");

await visit(bp, "/");
check(
  "on the public site the builder's header shows Builder portal only",
  (await bp.locator("header").getByRole("link", { name: "Builder portal" }).count()) > 0 &&
    (await bp.locator("header").getByRole("link", { name: "Saved", exact: true }).count()) === 0 &&
    (await bp.locator("header").getByRole("link", { name: "My account" }).count()) === 0 &&
    (await bp.locator("header").getByRole("link", { name: "List your project" }).count()) === 0 &&
    (await bp.locator("header").getByRole("link", { name: "Log in" }).count()) === 0,
);

await visitList(bp);
check(
  "builders do not get hearts on the marketplace",
  (await hearts(bp).count()) === 0 &&
    (await bp.locator('[data-testid="listing-card"]').count()) === 1,
);
const projectAnswered = bp
  .waitForResponse((r) => r.url().includes("/api/shortlist"), { timeout: 10000 })
  .catch(() => null);
await bp.goto(baseUrl + "/project/green-valley");
await projectAnswered;
await settle(bp);
check(
  "nor a Save button on a project page",
  (await bp.getByRole("button", { name: /^Save / }).count()) === 0,
);
check(
  "but the Share button is still there",
  (await bp.getByRole("button", { name: "Share" }).count()) === 1,
);

const builderApi = await bp.request.get(baseUrl + "/api/shortlist");
const builderList = await builderApi.json();
check(
  "the save API tells a builder they cannot save",
  builderList.authenticated === true &&
    builderList.canSave === false &&
    builderList.ids.length === 0,
  JSON.stringify(builderList),
);
const builderPost = await bp.request.post(baseUrl + "/api/shortlist", {
  data: { projectId, saved: true },
  headers: { "Content-Type": "application/json" },
});
check("and refuses a save outright", builderPost.status() === 403, String(builderPost.status()));
check(
  "the project the person saved as a buyer is kept, not deleted",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "Shortlist" s JOIN "User" u ON u.id = s."userId" WHERE u.email = 'rbuyer@test.example'`,
    )
  )[0].n === 1,
);

const builderPhone = await open(people.buyer, PHONE);
await visit(builderPhone.page, "/");
await builderPhone.page.getByRole("button", { name: "Open menu" }).click();
check(
  "on a phone the builder's menu shows the portal link",
  (await builderPhone.page
    .locator("#mobile-menu")
    .getByRole("link", { name: "Builder portal" })
    .count()) === 1,
);
check(
  "the portal fits a phone screen",
  await (async () => {
    await builderPhone.page.goto(baseUrl + "/portal");
    await settle(builderPhone.page);
    return !(await overflows(builderPhone.page));
  })(),
);
await builderPhone.context.close();

// =======================================================================================
section("4. An admin");

const admin = await open(people.admin);
const ap = admin.page;
check(
  "buyer door: an admin goes to the console",
  (await go(ap, "/dashboard?as=buyer")) === "/admin",
  where(ap),
);
check("builder door: also to the console", (await go(ap, "/dashboard?as=builder")) === "/admin");
check("no door: also to the console", (await go(ap, "/dashboard")) === "/admin");
check("the admin shell says Admin", (await ap.getByTestId("account-kind").innerText()) === "Admin");
await visit(ap, "/");
check(
  "the admin's public header shows Admin console only",
  (await ap.locator("header").getByRole("link", { name: "Admin console" }).count()) > 0 &&
    (await ap.locator("header").getByRole("link", { name: "Saved", exact: true }).count()) === 0 &&
    (await ap.locator("header").getByRole("link", { name: "Builder portal" }).count()) === 0,
);
await visitList(ap);
check("admins do not get hearts either", (await hearts(ap).count()) === 0);
const adminPost = await ap.request.post(baseUrl + "/api/shortlist", {
  data: { projectId, saved: true },
  headers: { "Content-Type": "application/json" },
});
check("and cannot save through the API", adminPost.status() === 403, String(adminPost.status()));
check(
  "the buyer pages send the admin to the console",
  (await go(ap, "/account")) === "/admin" && (await go(ap, "/account/shortlist")) === "/admin",
);

// =======================================================================================
section("5. The door never grants anything");

const fresh = await open({
  sub: "auth0|r-fresh",
  email: "fresh@test.example",
  email_verified: true,
  name: "Fresh Person",
});
check(
  "a brand-new person through the builder door ends at the builder sign-up page",
  (await go(fresh.page, "/dashboard?as=builder")) === "/start-listing",
  where(fresh.page),
);
check(
  "and is still only a buyer until they press the button",
  (await sql(`SELECT role FROM "User" WHERE email = 'fresh@test.example'`))[0].role === "BUYER",
);
const anonDash = await fetch(baseUrl + "/dashboard?as=builder", { redirect: "manual" });
check(
  "logged out, /dashboard?as=builder asks for a login first",
  anonDash.status === 307 && (anonDash.headers.get("location") ?? "").includes("/auth/login"),
  `${anonDash.status} ${anonDash.headers.get("location")}`,
);
const anonAccount = await fetch(baseUrl + "/account", { redirect: "manual" });
check("logged out, buyer pages ask for a login", anonAccount.status === 307);
const anonPost = await fetch(baseUrl + "/api/shortlist", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
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
