// End-to-end check of the heart of the product: a builder with NO plan publishes a project, staff
// approve it, and buyers can find it. Traces the whole path in a real browser against a real
// Postgres: create, submit, review, approve, search (every page of the listing), project page, the
// builder's My Projects page, and everything that must NOT be visible.
//
//   node tests/e2e/visibility.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL>
//
// The server must run a production build with ADMIN_EMAILS=admin@test.example and an EMPTY database.
// No company in this suite ever gets a subscription: that is the point.
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

const person = (key, name) => ({
  sub: `auth0|v-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  ownerA: person("ownera", "Owner A"),
  ownerB: person("ownerb", "Owner B"),
  empty: person("empty", "Owner Empty"),
  buyer: person("buyer", "Asha Buyer"),
};

async function cookieFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const value = await generateSessionCookie(
    {
      user,
      tokenSet: { accessToken: "t", expiresAt: now + 3600 },
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
const id = () => randomUUID().replace(/-/g, "");

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
const here = (page) => new URL(page.url()).pathname;
const where = (page) => new URL(page.url()).pathname + new URL(page.url()).search;
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const overflows = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
async function go(page, route) {
  await page.goto(baseUrl + route);
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((u) => u.pathname !== "/welcome");
    await page.goto(baseUrl + route);
  }
  await settle(page);
  return where(page);
}
const slugsOnPage = (page) =>
  page
    .locator('[data-testid="listing-card"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-slug")));

// ---------------------------------------------------------------------------------------
async function company(name, slug, owner, state = "VERIFIED") {
  const builderId = id();
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,city,"verifiedAt","updatedAt") VALUES($1,$2,$3::"BuilderStatus",$4,'Hosur',now(),now())`,
    [builderId, name, state, slug],
  );
  const userId = id();
  await sql(
    `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,$2,$3,$4,'BUILDER_OWNER',now())`,
    [userId, owner.sub, owner.email, owner.name],
  );
  await sql(`INSERT INTO "BuilderMember"(id,"builderId","userId",role) VALUES($1,$2,$3,'OWNER')`, [
    id(),
    builderId,
    userId,
  ]);
  return builderId;
}
const cA = await company("Alpha Builders", "alpha", people.ownerA);
const cB = await company("Beta Builders", "beta", people.ownerB);
const cE = await company("Empty Builders", "empty", people.empty);
const cSuspended = await company(
  "Suspended Builders",
  "suspended",
  person("susp", "Suspended Owner"),
  "SUSPENDED",
);

async function seed(
  builderId,
  slug,
  name,
  status,
  { city = "Hosur", type = "PLOTTED", minutes = 0 } = {},
) {
  const projectId = id();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"publishedAt","updatedAt")
     VALUES($1,$2,$3,$4::"ProjectStatus",$5,$6::"ProjectType",'READY_TO_MOVE',$7,'Main Road',$8,now())`,
    [
      projectId,
      builderId,
      status === "LIVE" ? slug : null,
      status,
      name,
      type,
      city,
      status === "LIVE" ? new Date(Date.now() - minutes * 60000) : null,
    ],
  );
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt") VALUES($1,$2,'A-1','a-00000001',1000,1850000,'AVAILABLE',now())`,
    [id(), projectId],
  );
  return projectId;
}

// =======================================================================================
section("1. A builder with no plan creates and publishes a project");
const a = await open(people.ownerA);
const adm = await open(people.admin);
await go(a.page, "/portal/billing");
check(
  "the company is on the free plan: it has no subscription",
  Number((await sql(`SELECT count(*) AS n FROM "Subscription"`))[0].n) === 0 &&
    (await text(a.page)).includes("free plan"),
);
await go(a.page, "/portal/projects");
check(
  "My projects says publishing is free",
  (await a.page.getByTestId("project-allowance").innerText()).includes(
    "Publishing a project is free",
  ),
);
check(
  "with no projects yet it explains what to do",
  (await a.page.getByTestId("no-projects").innerText()).includes("Add your first project"),
);
await a.page.locator("#name").fill("Free Layout One");
await a.page.getByRole("button", { name: "Create" }).click();
await a.page.waitForURL(/\/portal\/projects\/[^/]+\/basics$/);
const projectId = here(a.page).split("/")[3];
await go(a.page, `/portal/projects/${projectId}/review`);
check(
  "the review page tells the builder that publishing is free",
  (await a.page.getByTestId("publish-note").innerText()).includes("no plan is needed"),
);
check(
  "and does not mention a plan as a requirement anywhere on the page",
  !/needs an active plan|choose a plan|buy a plan/i.test(await text(a.page)),
);
const submitButton = a.page.getByRole("button", { name: "Submit for review" });
check("Submit is available without a plan", await submitButton.isEnabled());

// two quick presses must not create two submissions or an inconsistent state
await Promise.all([
  submitButton.click().catch(() => {}),
  submitButton.click({ force: true }).catch(() => {}),
]);
await a.page.waitForURL(/saved=submitted/, { timeout: 15000 });
await settle(a.page);
check(
  "it goes to review with a clear message",
  (await text(a.page)).includes("Under review") ||
    (await text(a.page)).includes("Submitted for review"),
);
const afterSubmit = (await sql(`SELECT status, slug FROM "Project" WHERE id = $1`, [projectId]))[0];
check(
  "the status is saved: SUBMITTED, and not public yet (no address)",
  afterSubmit.status === "SUBMITTED" && afterSubmit.slug === null,
  JSON.stringify(afterSubmit),
);
check(
  "one press of Submit made one submission, even when pressed twice",
  Number(
    (
      await sql(
        `SELECT count(*) AS n FROM "AuditLog" WHERE action = 'project.submit' AND "entityId" = $1`,
        [projectId],
      )
    )[0].n,
  ) === 1,
);
check(
  "no payment, order or invoice was created",
  Number(
    (
      await sql(
        `SELECT (SELECT count(*) FROM "PaymentOrder") + (SELECT count(*) FROM "Invoice") AS n`,
      )
    )[0].n,
  ) === 0,
);
await go(a.page, "/portal/projects");
const card = a.page.locator('[data-testid="project-card"]', { hasText: "Free Layout One" });
check(
  "My projects shows it as In review, with what happens next",
  (await card.getAttribute("data-status")) === "SUBMITTED" &&
    (await card.getByTestId("next-step").innerText()).includes("checking it"),
);
check("and no public link yet", (await card.getByTestId("view-public").count()) === 0);

section("1b. Before approval buyers cannot see it");
const visitor = await open(null);
await go(visitor.page, "/projects?q=Free+Layout");
check(
  "search does not list a project that is only submitted",
  (await slugsOnPage(visitor.page)).length === 0,
);
check(
  "and says there are no matches rather than failing",
  /no projects|did not match|nothing/i.test(await text(visitor.page)),
);

// =======================================================================================
section("2. Staff approve it, and it goes live");
await go(adm.page, "/admin/projects");
await adm.page.getByRole("link", { name: "Free Layout One" }).click();
await adm.page.waitForURL(/\/admin\/projects\/.+/);
check(
  "staff are not blocked by the missing plan",
  await adm.page.getByRole("button", { name: "Approve and publish" }).isEnabled(),
);
await adm.page.getByRole("button", { name: "Approve and publish" }).click();
await adm.page.waitForURL(/saved=Decision/);
const live = (
  await sql(`SELECT status, slug, "publishedAt" FROM "Project" WHERE id = $1`, [projectId])
)[0];
check(
  "the project is live, with an address and a publish date",
  live.status === "LIVE" && !!live.slug && live.publishedAt !== null,
  JSON.stringify(live),
);

section("3. Buyers can find it straight away");
await go(visitor.page, "/projects?q=Free+Layout");
check(
  "it appears in search with no extra step",
  (await slugsOnPage(visitor.page)).includes(live.slug),
  (await slugsOnPage(visitor.page)).join(),
);
await go(visitor.page, "/projects");
check("and in the main listing", (await slugsOnPage(visitor.page)).includes(live.slug));
const pageResponse = await visitor.page.goto(baseUrl + `/project/${live.slug}`);
await settle(visitor.page);
check(
  "the project page opens for a visitor who is not logged in",
  pageResponse.status() === 200 &&
    (await visitor.page.locator("h1").innerText()).includes("Free Layout One"),
);
await visitor.page.reload();
await settle(visitor.page);
check(
  "a refresh keeps it",
  (await visitor.page.locator("h1").innerText()).includes("Free Layout One"),
);
await visitor.page.goto(baseUrl + "/projects");
await visitor.page
  .locator(`[data-testid="listing-card"][data-slug="${live.slug}"] a`)
  .first()
  .click();
await visitor.page.waitForURL(new RegExp(`/project/${live.slug}$`));
check(
  "a card in the listing links to the right project page",
  (await visitor.page.locator("h1").innerText()).includes("Free Layout One"),
);
const fresh = await open(null);
await go(fresh.page, "/projects");
check(
  "a brand new browser session sees it too",
  (await slugsOnPage(fresh.page)).includes(live.slug),
);
await go(fresh.page, "/");
check(
  "the home page lists it among the latest projects",
  (await slugsOnPage(fresh.page)).includes(live.slug) ||
    (await text(fresh.page)).includes("Free Layout One"),
);

await go(a.page, "/portal/projects");
const liveCard = a.page.locator('[data-testid="project-card"]', { hasText: "Free Layout One" });
check("My projects shows it as Live", (await liveCard.getAttribute("data-status")) === "LIVE");
const popupPromise = a.context.waitForEvent("page");
await liveCard.getByTestId("view-public").click();
const popup = await popupPromise;
await popup.waitForLoadState("load");
check(
  "View as a buyer opens the public page",
  popup.url().endsWith(`/project/${live.slug}`) &&
    (await popup.locator("h1").innerText()).includes("Free Layout One"),
);
await popup.close();

// =======================================================================================
section("4. Every eligible project is in the listing, on every page");
const liveSlugs = new Set([live.slug]);
for (let i = 1; i <= 30; i++) {
  const slug = `bulk-live-${String(i).padStart(2, "0")}`;
  await seed(i % 2 ? cA : cB, slug, `Bulk Live ${i}`, "LIVE", {
    city: i % 3 === 0 ? "Coimbatore" : "Hosur",
    type: i % 4 === 0 ? "FARM_HOUSE" : "PLOTTED",
    minutes: i,
  });
  liveSlugs.add(slug);
}
const hidden = {
  draft: await seed(cA, "x", "Hidden Draft", "DRAFT"),
  submitted: await seed(cA, "x", "Hidden Submitted", "SUBMITTED"),
  changes: await seed(cA, "x", "Hidden Changes", "CHANGES_REQUESTED"),
  archived: await seed(cA, "x", "Hidden Archived", "ARCHIVED"),
};
const pausedId = await seed(cA, "hidden-paused", "Hidden Paused", "LIVE");
await sql(`UPDATE "Project" SET status = 'PAUSED' WHERE id = $1`, [pausedId]);
await seed(cSuspended, "hidden-suspended-builder", "Hidden Suspended Builder Project", "LIVE");
const totalLive = liveSlugs.size;
await go(visitor.page, "/projects");
const headline = await text(visitor.page);
check(
  "the listing states the right total",
  new RegExp(`\\b${totalLive}\\b`).test(headline),
  headline.slice(0, 300),
);
const seen = [];
for (let pageNumber = 1; pageNumber <= 6; pageNumber++) {
  await go(visitor.page, `/projects?page=${pageNumber}`);
  const slugs = await slugsOnPage(visitor.page);
  if (slugs.length === 0) break;
  seen.push(...slugs);
}
check(
  "walking every page shows exactly the live projects: none missing, none repeated, none extra",
  seen.length === totalLive &&
    new Set(seen).size === totalLive &&
    [...liveSlugs].every((s) => seen.includes(s)),
  `saw ${seen.length}, unique ${new Set(seen).size}, expected ${totalLive}`,
);
check(
  "the first page is full and later pages continue (12 per page)",
  (await (async () => {
    await go(visitor.page, "/projects?page=1");
    return (await slugsOnPage(visitor.page)).length;
  })()) === 12,
);
check(
  "drafts, submitted, changes-requested, archived, paused and suspended-company projects are not in the listing",
  !seen.some((s) => /hidden/.test(s ?? "")) && !(await text(visitor.page)).includes("Hidden"),
);
await go(visitor.page, "/projects?page=99");
check(
  "a page past the end is a clear empty state, not an error",
  !/error|went wrong/i.test(await text(visitor.page)),
);
const cityList = [];
for (let p = 1; p <= 4; p++) {
  await go(visitor.page, `/projects/coimbatore?page=${p}`);
  const s = await slugsOnPage(visitor.page);
  if (s.length === 0) break;
  cityList.push(...s);
}
check(
  "the city page lists exactly that city's live projects (10 of them)",
  cityList.length === 10 && new Set(cityList).size === 10,
  String(cityList.length),
);
await go(visitor.page, "/projects?type=farm-houses");
const farms = await slugsOnPage(visitor.page);
check(
  "a type filter keeps only that type, and misses none",
  farms.length === 7 && farms.every((s) => s.startsWith("bulk-live-")),
  String(farms.length),
);
await go(visitor.page, "/projects?q=Bulk+Live+30");
check(
  "search by name finds the right project",
  (await slugsOnPage(visitor.page)).join() === "bulk-live-30",
);
await go(visitor.page, "/projects?q=zzzz-nothing");
check(
  "a search with no results says so",
  /no projects|did not match|nothing/i.test(await text(visitor.page)) &&
    (await slugsOnPage(visitor.page)).length === 0,
);

section("4b. Protected from the public");
for (const [what, slug] of [
  ["a paused project", "hidden-paused"],
  ["a project of a suspended company", "hidden-suspended-builder"],
  ["an address that never existed", "nope-nope"],
]) {
  const r = await fetch(baseUrl + `/project/${slug}`);
  check(`${what} is not found`, r.status === 404, `status ${r.status}`);
}
for (const [what, projectIdToTry] of [
  ["a draft", hidden.draft],
  ["a submitted project", hidden.submitted],
]) {
  const r = await fetch(baseUrl + `/project/${projectIdToTry}`);
  check(`${what} cannot be opened by its id either`, r.status === 404);
}
const sitemap = await (await fetch(baseUrl + "/sitemap.xml")).text();
check(
  "the sitemap lists live projects and nothing else",
  sitemap.includes(live.slug) && !/hidden/.test(sitemap),
);

// =======================================================================================
section("5. The builder's My projects page");
await go(a.page, "/portal/projects");
check(
  "it counts every group on its tabs",
  (await a.page.getByTestId("filter-live").innerText()).includes("(") &&
    (await a.page.getByTestId("filter-draft").count()) === 1,
);
const projectsTotal = Number(
  (
    await sql(
      `SELECT count(*) AS n FROM "Project" WHERE "builderId" = $1 AND status <> 'ARCHIVED'`,
      [cA],
    )
  )[0].n,
);
check(
  "All shows every project that is not archived",
  (await a.page.getByTestId("project-card").count()) === projectsTotal,
  `${await a.page.getByTestId("project-card").count()} vs ${projectsTotal}`,
);
await go(a.page, "/portal/projects?status=draft");
check(
  "the Drafts filter shows only drafts, and says what to do",
  (await a.page
    .getByTestId("project-card")
    .evaluateAll((els) => els.every((e) => e.getAttribute("data-status") === "DRAFT"))) &&
    (await a.page.getByTestId("next-step").first().innerText()).includes("publish"),
);
check(
  "a draft's main action is to review and publish it",
  (await a.page.getByTestId("primary-action").first().innerText()).includes("Review and publish"),
);
await go(a.page, "/portal/projects?status=live");
check(
  "the Live filter shows live projects with a public link each",
  (await a.page.getByTestId("project-card").count()) ===
    (await a.page.getByTestId("view-public").count()) &&
    (await a.page.getByTestId("project-card").count()) > 0,
);
await go(a.page, "/portal/projects?status=archived");
check(
  "archived projects are reachable, with no edit or publish actions",
  (await a.page.getByTestId("project-card").count()) === 1 &&
    (await a.page.getByTestId("primary-action").count()) === 0,
);
await go(a.page, "/portal/projects?q=Bulk+Live+9");
check("search finds a project by name", (await a.page.getByTestId("project-card").count()) >= 1);
await go(a.page, "/portal/projects?q=zzzz");
check(
  "a search with no match says so and offers a way back",
  (await a.page.getByTestId("no-matches").count()) === 1,
);
check(
  "a builder with no projects sees the empty state",
  await (async () => {
    const e = await open(people.empty);
    await go(e.page, "/portal/projects");
    const ok = (await e.page.getByTestId("no-projects").count()) === 1;
    await e.context.close();
    return ok;
  })(),
);

section("5b. Ownership");
const b = await open(people.ownerB);
await go(b.page, "/portal"); // accepts the terms on a first visit
check(
  "another company cannot open this company's project to edit it",
  (await b.page.goto(baseUrl + `/portal/projects/${projectId}/basics`))?.status() === 404,
);
check(
  "nor to submit it",
  (await b.page.goto(baseUrl + `/portal/projects/${hidden.draft}/review`))?.status() === 404,
);
await go(b.page, "/portal/projects");
check(
  "their own list never includes it",
  (await b.page.getByTestId("project-card").filter({ hasText: "Free Layout One" }).count()) === 0 &&
    (await b.page.getByTestId("project-card").filter({ hasText: "Hidden Draft" }).count()) === 0,
);
const buyer = await open(people.buyer);
await go(buyer.page, "/account");
check(
  "a buyer has no way into the builder portal",
  (await go(buyer.page, "/portal"), here(buyer.page) !== "/portal"),
);

section("5c. A rejected or changed project");
await go(adm.page, `/admin/projects`);
const bId = await seed(cB, "x", "Needs A Fix", "DRAFT");
await sql(
  `UPDATE "Project" SET status = 'CHANGES_REQUESTED', "reviewNote" = 'Please add the plot sizes.' WHERE id = $1`,
  [bId],
);
await go(b.page, "/portal/projects?status=changes");
const fixCard = b.page.locator('[data-testid="project-card"]', { hasText: "Needs A Fix" });
check(
  "a project needing changes shows the reviewer's words and a clear action",
  (await fixCard.getByTestId("next-step").innerText()).includes("Please add the plot sizes.") &&
    (await fixCard.getByTestId("primary-action").innerText()).includes("Fix and publish again"),
);

// =======================================================================================
section("6. Nothing was charged");
check(
  "the whole suite created no plan, order or invoice",
  Number(
    (
      await sql(
        `SELECT (SELECT count(*) FROM "Subscription") + (SELECT count(*) FROM "PaymentOrder") + (SELECT count(*) FROM "Invoice") AS n`,
      )
    )[0].n,
  ) === 0,
);

section("7. Phone width");
for (const [user, route] of [
  [people.ownerA, "/portal/projects"],
  [people.ownerA, "/portal/projects?status=live"],
  [null, "/projects"],
  [null, `/project/${live.slug}`],
]) {
  const phone = await open(user, PHONE);
  await go(phone.page, route);
  check(
    `${route.replace(/[a-z0-9]{20,}/g, ":id")} does not scroll sideways`,
    !(await overflows(phone.page)),
  );
  await phone.context.close();
}

await browser.close();
await db.end();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
