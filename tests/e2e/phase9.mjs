// End-to-end check of analytics, reviews, the layout map and construction progress, in a real
// browser against a real Postgres, with the dev mail outbox and local file storage. See
// docs/GROWTH-FEATURES.md and docs/TESTING.md.
//
//   node tests/e2e/phase9.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL> <mailOutboxDir> <CRON_SECRET>
//
// The server must run a production build with MAIL_DRIVER=file, MAIL_OUTBOX_DIR set to the folder
// passed here, STORAGE_DRIVER=local, CRON_SECRET set to the value passed here,
// ADMIN_EMAILS=admin@test.example and an EMPTY database.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";

const [, , projectDir, baseUrl, secret, databaseUrl, outboxDir, cronSecret] = process.argv;
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
  sub: `auth0|n-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  ownerA: person("ownera", "Owner A"),
  ownerB: person("ownerb", "Owner B"),
  buyer: person("buyer", "Asha Kumar"),
  stranger: person("stranger", "Sam Stranger"),
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
const id = () => randomUUID().replace(/-/g, "");

const browser = await chromium.launch({ channel: "msedge" });
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
async function open(user, viewport = DESKTOP) {
  // A headless browser announces itself as one, and the analytics ignore those, so the tests present
  // an ordinary browser's name.
  const context = await browser.newContext({
    viewport,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
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
async function acceptTermsIfAsked(page) {
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await settle(page);
    return true;
  }
  return false;
}
async function go(page, route) {
  await page.goto(baseUrl + route);
  if (await acceptTermsIfAsked(page)) await page.goto(baseUrl + route);
  await settle(page);
  return where(page);
}
async function act(page, click) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 15000 }),
    click(),
  ]);
  await page.waitForTimeout(700);
  await settle(page);
}
const mailbox = async () => {
  try {
    return (await readFile(path.join(outboxDir, "mail-outbox.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const mailTo = async (address, part) =>
  (await mailbox()).filter((m) => [].concat(m.to).includes(address) && m.subject.includes(part));
const cron = (job) =>
  fetch(`${baseUrl}/api/cron/${job}`, { headers: { Authorization: `Bearer ${cronSecret}` } });

// A real 1x1 PNG, for the photo uploads.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------------------
async function company(name, slug, owner, plan) {
  const builderId = id();
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,$2,'VERIFIED',$3,now(),now())`,
    [builderId, name, slug],
  );
  await sql(
    `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,$3,'COMP',now(),now()+interval '60 days',now())`,
    [id(), builderId, plan],
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
async function project(builderId, slug, name, plots = 6) {
  const projectId = id();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"contactMobile",whatsapp,"publishedAt","updatedAt") VALUES($1,$2,$3,'LIVE',$4,'PLOTTED','READY_TO_MOVE','Hosur','Main Road','9876543210','9876543210',now(),now())`,
    [projectId, builderId, slug, name],
  );
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt")
     SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),1000+g,1850000,(CASE WHEN g=2 THEN 'BOOKED' WHEN g=3 THEN 'SOLD' ELSE 'AVAILABLE' END)::"PlotStatus",now() FROM generate_series(1,$2::int) g`,
    [projectId, plots],
  );
  return projectId;
}
const cA = await company("Alpha Builders", "alpha", people.ownerA, "PREMIER");
const cB = await company("Beta Builders", "beta", people.ownerB, "STARTER");
const pA = await project(cA, "alpha-one", "Alpha One");
const pB = await project(cB, "beta-one", "Beta One");

// buyer accounts and an enquiry from the buyer to company A
for (const user of [people.buyer, people.stranger]) {
  const s = await open(user);
  await go(s.page, "/account");
  await s.context.close();
}
const buyerId = (await sql(`SELECT id FROM "User" WHERE email = $1`, [people.buyer.email]))[0].id;
await sql(
  `INSERT INTO "Lead"(id,"projectId","builderId","buyerId",name,mobile,email,"consentAt","consentTermsVersion","updatedAt") VALUES($1,$2,$3,$4,'Asha Kumar','9876543210',$5,now(),'v1',now())`,
  [id(), pA, cA, buyerId, people.buyer.email],
);
const origin = new URL(baseUrl).origin;
const beacon = (body, headers = {}) =>
  fetch(`${baseUrl}/api/track`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      ...headers,
    },
  });
const stat = async (projectId, event) =>
  Number(
    (
      await sql(
        `SELECT COALESCE(SUM(count),0) AS n FROM "ProjectDailyStat" WHERE "projectId" = $1 AND event = $2::"StatEvent"`,
        [projectId, event],
      )
    )[0].n,
  );

// =======================================================================================
section("1. Counting visits, and nothing else");
check(
  "a real visit is counted",
  (await beacon({ slug: "alpha-one", event: "VIEW", source: "search" })).status === 204 &&
    (await stat(pA, "VIEW")) === 1,
);
check(
  "a tap on Call is counted",
  (await beacon({ slug: "alpha-one", event: "CALL" })).status === 204 &&
    (await stat(pA, "CALL")) === 1,
);
check(
  "a message from another website is refused",
  (await beacon({ slug: "alpha-one", event: "VIEW" }, { origin: "https://evil.example" }))
    .status === 403,
);
check(
  "a message with no origin is refused",
  (
    await fetch(`${baseUrl}/api/track`, {
      method: "POST",
      body: JSON.stringify({ slug: "alpha-one", event: "VIEW" }),
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome/126" },
    })
  ).status === 403,
);
check(
  "a crawler is answered quietly and not counted",
  (await beacon({ slug: "alpha-one", event: "VIEW" }, { "user-agent": "Googlebot/2.1" })).status ===
    204 && (await stat(pA, "VIEW")) === 1,
);
check(
  "a browser cannot report an enquiry or a visit request itself",
  (await beacon({ slug: "alpha-one", event: "ENQUIRY" })).status === 400 &&
    (await beacon({ slug: "alpha-one", event: "VISIT" })).status === 400,
);
check(
  "garbage is refused",
  (await beacon("nope")).status === 400 && (await beacon({ event: "VIEW" })).status === 400,
);
check(
  "an unknown project is silently ignored",
  (await beacon({ slug: "does-not-exist", event: "VIEW" })).status === 204,
);
await sql(`UPDATE "Project" SET status = 'PAUSED' WHERE id = $1`, [pB]);
await beacon({ slug: "beta-one", event: "VIEW" });
check("a project that is not public is not counted", (await stat(pB, "VIEW")) === 0);
await sql(`UPDATE "Project" SET status = 'LIVE' WHERE id = $1`, [pB]);
check("only POST is allowed", (await fetch(`${baseUrl}/api/track`)).status === 405);
let limited = 0;
for (let i = 0; i < 100; i++)
  if (
    (await beacon({ slug: "alpha-one", event: "CALL" }, { "x-forwarded-for": "203.0.113.9" }))
      .status === 429
  )
    limited++;
check(
  "one address is limited, so numbers cannot be inflated by a loop",
  limited >= 8,
  `limited ${limited}`,
);
await sql(`DELETE FROM "ProjectDailyStat"`);

const visitor = await open(null);
await visitor.page.goto(baseUrl + "/project/alpha-one");
await settle(visitor.page);
await visitor.page.waitForTimeout(800);
check(
  "opening a project page counts one view in the browser",
  (await stat(pA, "VIEW")) === 1,
  String(await stat(pA, "VIEW")),
);
await visitor.page.reload();
await settle(visitor.page);
await visitor.page.waitForTimeout(500);
check("a refresh in the same session does not count again", (await stat(pA, "VIEW")) === 1);
check(
  "it is recorded as a direct visit",
  (await sql(`SELECT source FROM "ProjectDailyStat" WHERE event = 'VIEW'`))[0].source === "direct",
);
await visitor.page
  .getByTestId("call-builder")
  .first()
  .evaluate((el) => el.addEventListener("click", (e) => e.preventDefault()));
await visitor.page.getByTestId("call-builder").first().click();
await visitor.page.waitForTimeout(800);
check("tapping Call is counted", (await stat(pA, "CALL")) === 1, String(await stat(pA, "CALL")));

// =======================================================================================
section("2. The analytics page, by plan");
await sql(`DELETE FROM "ProjectDailyStat"`);
const today = new Date().toISOString().slice(0, 10);
await sql(
  `INSERT INTO "ProjectDailyStat"("projectId",day,event,source,count) VALUES ($1,$2::date,'VIEW','search',40),($1,$2::date,'VIEW','direct',10),($1,$2::date,'ENQUIRY','direct',5),($1,$2::date,'VISIT','direct',2),($1,$2::date,'CALL','direct',7),($1,$2::date,'SHORTLIST','direct',3)`,
  [pA, today],
);
const a = await open(people.ownerA);
await go(a.page, "/portal/analytics");
const tiles = await a.page.getByTestId("analytics-tiles").innerText();
check(
  "the tiles show the totals",
  /50\s*\n?\s*Page views/.test(tiles) &&
    /5\s*\n?\s*Enquiries/.test(tiles) &&
    /7\s*\n?\s*Calls/.test(tiles) &&
    /3\s*\n?\s*Saved/.test(tiles),
  tiles,
);
check("enquiries are shown as a share of views", tiles.includes("10% of views"), tiles);
check(
  "the chart is there, with a table for screen readers",
  (await a.page.getByTestId("analytics-chart").count()) === 1 &&
    (await a.page.getByText("Show the numbers as a table").count()) === 1,
);
check(
  "the chart is labelled",
  (
    await a.page.locator('[data-testid="analytics-chart"] svg').getAttribute("aria-label")
  )?.includes("last 30 days"),
);
const sources = await a.page.getByTestId("sources").innerText();
check(
  "sources add up: search 40, direct 10",
  sources.includes("Search results") &&
    sources.includes("40") &&
    sources.includes("Direct or shared link"),
  sources,
);
const funnel = await a.page.getByTestId("funnel").innerText();
check(
  "the funnel runs from views to booked",
  ["Viewed a project", "50", "Sent an enquiry", "Asked for a site visit", "Booked"].every((s) =>
    funnel.includes(s),
  ),
  funnel,
);
check(
  "the by-project table lists the company's projects only",
  (await a.page.getByTestId("by-project").innerText()).includes("Alpha One") &&
    !(await a.page.getByTestId("by-project").innerText()).includes("Beta One"),
);
check("Premier sees the CSV export", (await a.page.getByTestId("export-analytics").count()) === 1);
const csv = await a.context.request.get(baseUrl + "/api/builder/analytics/export");
const csvText = await csv.text();
check(
  "the export is a CSV of the company's own numbers",
  csv.status() === 200 &&
    csvText.startsWith("Date,Project,Event,Source,Count") &&
    csvText.includes("Alpha One") &&
    !csvText.includes("Beta One"),
  csvText.slice(0, 200),
);

const b = await open(people.ownerB);
await go(b.page, "/portal/analytics");
check(
  "a Starter company sees an upgrade note instead",
  (await b.page.getByTestId("upgrade-notice").count()) === 1 &&
    (await b.page.getByTestId("analytics-tiles").count()) === 0,
);
check(
  "and the export is refused by the server",
  (await b.context.request.get(baseUrl + "/api/builder/analytics/export")).status() === 403,
);
await sql(`UPDATE "Subscription" SET plan = 'GROWTH' WHERE "builderId" = $1`, [cB]);
await go(b.page, "/portal/analytics");
check(
  "a Growth company sees the page but no export button",
  (await b.page.getByTestId("analytics-tiles").count()) === 1 &&
    (await b.page.getByTestId("export-analytics").count()) === 0 &&
    (await b.page.getByText("CSV export is part of the Premier plan").count()) === 1,
);
check(
  "and the export is still refused",
  (await b.context.request.get(baseUrl + "/api/builder/analytics/export")).status() === 403,
);
await sql(`UPDATE "Subscription" SET plan = 'STARTER' WHERE "builderId" = $1`, [cB]);
check(
  "an anonymous request to the export is refused",
  (await fetch(baseUrl + "/api/builder/analytics/export", { redirect: "manual" })).status !== 200,
);

section("2b. The monthly email");
const ran = await (await cron("performance")).json();
check(
  "the performance job runs for companies with analytics, once",
  ran.reported === 1,
  JSON.stringify(ran),
);
check("the second run sends nothing", (await (await cron("performance")).json()).reported === 0);
check("the owner got the email", (await mailTo(people.ownerA.email, "performance")).length === 1);

// =======================================================================================
section("3. Reviews");
const buyer = await open(people.buyer);
await go(buyer.page, "/account/enquiries");
check(
  "a buyer with an enquiry is offered a review link",
  (await buyer.page.getByTestId("review-link").count()) === 1,
);
const stranger = await open(people.stranger);
await go(stranger.page, `/account/reviews/${cA}`);
check(
  "a stranger cannot review, and is told why",
  (await stranger.page.getByTestId("review-not-allowed").innerText()).includes(
    "after you have sent it an enquiry",
  ),
);
await go(buyer.page, `/account/reviews/${cA}`);
check("the buyer sees the form", (await buyer.page.locator("#review-body").count()) === 1);
await buyer.page.getByLabel("5 stars").check();
await buyer.page
  .locator("#review-body")
  .fill("<b>Great</b> team. They answered every question and the plot matched the brochure.");
await act(buyer.page, () => buyer.page.getByRole("button", { name: "Send my review" }).click());
check(
  "it is accepted and waits for staff",
  (await buyer.page.getByTestId("review-saved").count()) === 1 &&
    (await buyer.page.getByTestId("review-status").innerText()).includes("Waiting"),
);
check(
  "it is stored under a shortened name",
  (await sql(`SELECT "displayName", status FROM "Review"`))[0].displayName === "Asha K.",
);
const pub = await open(null);
await pub.page.goto(baseUrl + "/builder/alpha");
await settle(pub.page);
check(
  "it is not public yet",
  (await pub.page.getByTestId("review").count()) === 0 &&
    (await pub.page.getByTestId("builder-rating").count()) === 0,
);

const adm = await open(people.admin);
await go(adm.page, "/admin/reviews");
check("staff see it waiting", (await adm.page.getByTestId("pending-review").count()) === 1);
check(
  "staff see it as plain text, with the markup shown as typed",
  (await adm.page.getByTestId("pending-review").innerText()).includes("<b>Great</b>"),
);
await adm.page.getByPlaceholder(/Reason, if you reject/).fill("no");
await act(adm.page, () => adm.page.getByRole("button", { name: "Reject" }).click());
check(
  "a rejection needs a real reason",
  (await text(adm.page)).includes("Give a reason") &&
    (await sql(`SELECT status FROM "Review"`))[0].status === "PENDING",
);
await adm.page
  .getByPlaceholder(/Reason, if you reject/)
  .fill("Please remove the formatting characters.");
await act(adm.page, () => adm.page.getByRole("button", { name: "Reject" }).click());
check(
  "a rejected review says why to the buyer",
  await (async () => {
    await go(buyer.page, `/account/reviews/${cA}`);
    return (await buyer.page.getByTestId("review-status").innerText()).includes(
      "Please remove the formatting characters.",
    );
  })(),
);
await buyer.page
  .locator("#review-body")
  .fill("Great team. They answered every question and the plot matched the brochure exactly.");
await act(buyer.page, () => buyer.page.getByRole("button", { name: "Update my review" }).click());
await go(adm.page, "/admin/reviews");
await act(adm.page, () => adm.page.getByRole("button", { name: "Publish" }).click());
check("staff publish it", (await sql(`SELECT status FROM "Review"`))[0].status === "PUBLISHED");

await pub.page.goto(baseUrl + "/builder/alpha");
await settle(pub.page);
check(
  "it is on the builder's page, with the rating and a verified-enquirer label",
  (await pub.page.getByTestId("review").count()) === 1 &&
    (await pub.page.getByTestId("review").innerText()).includes("Verified enquirer") &&
    (await pub.page.getByTestId("builder-rating").innerText())
      .replace(/\s+/g, " ")
      .includes("5.0 (1 review)"),
);
check(
  "the reviewer is shown as Asha K., never in full",
  (await pub.page.getByTestId("review").innerText()).includes("Asha K.") &&
    !(await pub.page.getByTestId("review").innerText()).includes("Asha Kumar"),
);
await pub.page.goto(baseUrl + "/project/alpha-one");
await settle(pub.page);
check(
  "the project page shows the company's rating",
  (await pub.page.getByTestId("builder-rating").innerText()).includes("5.0"),
);

await go(a.page, "/portal/reviews");
check(
  "the company sees it, with the average",
  (await a.page.getByTestId("rating-summary").innerText()).includes("5.0") &&
    (await a.page.getByTestId("company-review").count()) === 1,
);
await a.page
  .locator("textarea[name=reply]")
  .fill("Thank you, Asha. We are glad the visit went well.");
await act(a.page, () => a.page.getByRole("button", { name: "Send reply" }).click());
check(
  "the company can reply",
  (await sql(`SELECT reply FROM "Review"`))[0].reply?.startsWith("Thank you, Asha"),
);
await pub.page.goto(baseUrl + "/builder/alpha");
await settle(pub.page);
check(
  "the reply shows under the review",
  (await pub.page.getByTestId("review-reply").innerText()).includes(
    "We are glad the visit went well",
  ),
);
await buyer.page.goto(baseUrl + `/account/reviews/${cA}`);
await buyer.page
  .locator("#review-body")
  .fill("Great team. Update after buying: still happy with the registration process.");
await act(buyer.page, () => buyer.page.getByRole("button", { name: "Update my review" }).click());
await pub.page.goto(baseUrl + "/builder/alpha");
await settle(pub.page);
check(
  "editing a published review takes it down until staff read it again",
  (await pub.page.getByTestId("review").count()) === 0,
);
check("a company with no reviews says so", (await text(pub.page)).includes("No reviews yet"));
const tm = await open(people.ownerB);
await go(tm.page, `/portal/reviews`);
check(
  "another company sees nobody else's reviews",
  (await tm.page.getByTestId("company-review").count()) === 0,
);
check(
  "a buyer cannot open the staff page",
  (await go(buyer.page, "/admin/reviews")) !== "/admin/reviews",
);

// =======================================================================================
section("4. The layout map");
await go(b.page, `/portal/projects/${pB}/layout-map`);
check(
  "a Starter company is offered an upgrade, not the editor",
  (await b.page.getByTestId("upgrade-notice").count()) === 1 &&
    (await b.page.getByTestId("map-canvas").count()) === 0,
);
await go(a.page, `/portal/projects/${pA}/layout-map`);
check("a Premier company gets the editor", (await a.page.getByTestId("map-canvas").count()) === 1);
check("the wizard stepper does not call it a step", !(await text(a.page)).includes("Step 1 of"));
check(
  "it says 0 of 6 plots placed",
  (await a.page.getByTestId("map-status").innerText()).includes("0 of 6 plots placed"),
);
const canvas = a.page.getByTestId("map-canvas");
const box = await canvas.boundingBox();
async function draw(fx, fy, tx, ty) {
  await a.page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await a.page.mouse.down();
  await a.page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 6 });
  await a.page.mouse.up();
}
await draw(0.05, 0.1, 0.2, 0.3);
check(
  "dragging draws the first plot",
  (await a.page.getByTestId("map-shape").count()) === 1 &&
    (await a.page.getByTestId("map-shape").first().getAttribute("data-plot")) === "A-1",
);
await draw(0.25, 0.1, 0.4, 0.3);
await draw(0.45, 0.1, 0.6, 0.3);
check(
  "each drag takes the next plot",
  (await a.page.getByTestId("map-shape").count()) === 3 &&
    (await a.page.getByTestId("map-status").innerText()).includes("3 of 6 plots placed"),
);
const first = a.page.getByTestId("map-shape").first();
const before = await first.boundingBox();
await a.page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
await a.page.mouse.down();
await a.page.mouse.move(
  before.x + before.width / 2,
  before.y + before.height / 2 + box.height * 0.3,
  { steps: 6 },
);
await a.page.mouse.up();
const after = await first.boundingBox();
check("a plot can be dragged to move it", after.y > before.y + 20, `${before.y} -> ${after.y}`);
check(
  "a plot cannot be dragged off the map",
  await (async () => {
    const s = await a.page.getByTestId("map-shape").nth(2).boundingBox();
    await a.page.mouse.move(s.x + 3, s.y + 3);
    await a.page.mouse.down();
    await a.page.mouse.move(box.x + box.width + 300, box.y + box.height + 300, { steps: 5 });
    await a.page.mouse.up();
    const moved = await a.page.getByTestId("map-shape").nth(2).boundingBox();
    return (
      moved.x + moved.width <= box.x + box.width + 2 &&
      moved.y + moved.height <= box.y + box.height + 2
    );
  })(),
);
await first.click();
const handle = a.page.getByTestId("resize-handle");
const hb = await handle.boundingBox();
await a.page.mouse.move(hb.x + 4, hb.y + 4);
await a.page.mouse.down();
await a.page.mouse.move(hb.x + 4 + box.width * 0.1, hb.y + 4 + box.height * 0.05, { steps: 5 });
await a.page.mouse.up();
check("the corner handle resizes it", (await first.boundingBox()).width > after.width + 10);
await first.click();
await a.page.keyboard.press("ArrowRight");
await a.page.keyboard.press("ArrowRight");
check("arrow keys nudge the selected plot", (await first.boundingBox()).x > after.x);

await a.page.getByText("Set positions with numbers").click();
await a.page.getByRole("button", { name: "Add" }).first().click();
check(
  "a plot can be added from the table, with no mouse",
  (await a.page.getByTestId("map-shape").count()) === 4,
);
await a.page.getByLabel("A-4 x").fill("70");
await a.page.getByLabel("A-4 y").fill("40");
await a.page.getByRole("button", { name: "Add" }).first().click();
await a.page.getByRole("button", { name: "Add" }).first().click();
check(
  "all six plots can be placed",
  (await a.page.getByTestId("map-status").innerText()).includes("6 of 6 plots placed"),
);
await act(a.page, () => a.page.getByTestId("save-map").click());
check(
  "saving reports success",
  (await a.page.getByTestId("map-status").innerText()).includes("Saved. 6 plots on the map."),
  await a.page.getByTestId("map-status").innerText(),
);
check(
  "the map is in the database, with positions as percentages",
  (
    await sql(
      `SELECT count(*)::int AS n, max(x) AS maxx FROM "LayoutShape" WHERE "projectId" = $1`,
      [pA],
    )
  )[0].n === 6,
);
await go(a.page, `/portal/projects/${pA}/layout-map`);
check(
  "the saved map comes back when the editor is reopened",
  (await a.page.getByTestId("map-shape").count()) === 6,
);

await pub.page.goto(baseUrl + "/project/alpha-one");
await settle(pub.page);
check(
  "buyers see the map on the project page",
  (await pub.page.getByTestId("layout-map").count()) === 1 &&
    (await pub.page.getByTestId("map-plot").count()) === 6,
);
const statuses = await pub.page
  .getByTestId("map-plot")
  .evaluateAll((els) =>
    els.map((e) => [e.getAttribute("data-plot"), e.getAttribute("data-status")]),
  );
check(
  "plots are coloured by status: A-1 available, A-2 booked, A-3 sold",
  JSON.stringify(statuses.slice(0, 3)) ===
    JSON.stringify([
      ["A-1", "AVAILABLE"],
      ["A-2", "BOOKED"],
      ["A-3", "SOLD"],
    ]),
  JSON.stringify(statuses),
);
check(
  "each plot has a spoken label",
  (await pub.page.getByTestId("map-plot").first().getAttribute("aria-label")).includes(
    "Plot A-1, 1,001 square feet, Available",
  ),
);
await pub.page.getByTestId("map-plot").nth(1).click();
check(
  "tapping a plot shows its details",
  (await pub.page.getByTestId("map-details").innerText()).includes("A-2") &&
    (await pub.page.getByTestId("map-details").innerText()).includes("Booked"),
);
await pub.page.getByTestId("map-plot").first().focus();
await pub.page.keyboard.press("Enter");
check(
  "the keyboard works too",
  (await pub.page.getByTestId("map-details").innerText()).includes("A-1"),
);
check(
  "the plot table is still on the page for anyone who prefers it",
  (await pub.page.locator("#plots").count()) === 1,
);
await pub.page.goto(baseUrl + "/project/beta-one");
await settle(pub.page);
check("a project with no map shows none", (await pub.page.getByTestId("layout-map").count()) === 0);

await sql(`UPDATE "Subscription" SET plan = 'STARTER' WHERE "builderId" = $1`, [cA]);
await go(a.page, `/portal/projects/${pA}/layout-map`);
check(
  "after a downgrade the editor is replaced by an upgrade note",
  (await a.page.getByTestId("upgrade-notice").count()) === 1,
);
await sql(`UPDATE "Subscription" SET plan = 'PREMIER' WHERE "builderId" = $1`, [cA]);

// =======================================================================================
section("5. Construction progress");
await sql(`INSERT INTO "Shortlist"("userId","projectId") VALUES ($1,$2)`, [buyerId, pA]);
await go(a.page, `/portal/projects/${pA}/progress`);
check("the owner sees the update form", (await a.page.getByTestId("progress-form").count()) === 1);
await a.page
  .locator("#progress-note")
  .fill("Internal roads laid in phase one. Street lights next week.");
await a.page
  .locator("#progress-photo")
  .setInputFiles({ name: "site.png", mimeType: "image/png", buffer: PNG });
await a.page.getByRole("button", { name: "Post the update" }).click();
await a.page.getByTestId("progress-message").waitFor();
check("it posts", (await a.page.getByTestId("progress-message").innerText()).includes("Posted"));
await a.page.waitForTimeout(1500);
check(
  "it is listed, with its photo",
  (await a.page.getByTestId("progress-item").count()) === 1 &&
    (await a.page.getByTestId("progress-item").locator("img").count()) === 1,
);
const updateRow = (await sql(`SELECT * FROM "ProgressUpdate"`))[0];
check(
  "the photo is a public file",
  updateRow.photoKey.includes("/public/projects/"),
  updateRow.photoKey,
);
const photoResponse = await a.context.request.get(
  baseUrl + (await a.page.getByTestId("progress-item").locator("img").getAttribute("src")),
);
check(
  "and it can be fetched",
  photoResponse.status() === 200 &&
    (photoResponse.headers()["content-type"] ?? "").startsWith("image/"),
);
await new Promise((r) => setTimeout(r, 1500));
check(
  "the buyer who saved the project is emailed",
  (await mailTo(people.buyer.email, "New update on Alpha One")).length === 1,
);
check(
  "and nobody who did not save it",
  (await mailTo(people.stranger.email, "New update")).length === 0,
);

await pub.page.goto(baseUrl + "/project/alpha-one");
await settle(pub.page);
check(
  "buyers see the update on the project page, dated",
  (await pub.page.getByTestId("progress-update").count()) === 1 &&
    (await pub.page.getByTestId("progress-updates").innerText()).includes("Internal roads laid"),
);
check(
  "with the photo",
  (await pub.page.getByTestId("progress-update").locator("img").count()) === 1,
);

await a.page.locator("#progress-note").fill("ok");
await a.page.getByRole("button", { name: "Post the update" }).click();
await a.page.waitForTimeout(500);
check(
  "a one-word note is refused by the browser or the server",
  (await sql(`SELECT count(*)::int AS n FROM "ProgressUpdate"`))[0].n === 1,
);
await a.page.locator("#progress-note").evaluate((el) => {
  el.removeAttribute("minlength");
});
await a.page.getByRole("button", { name: "Post the update" }).click();
await a.page.getByTestId("progress-message").waitFor();
await a.page.waitForTimeout(300);
check(
  "the server refuses it with a reason",
  (await a.page.getByTestId("progress-message").innerText()).includes("5 to 500 characters"),
);
const notPng = await a.context.request.post(`${baseUrl}/api/builder/projects/${pA}/progress`, {
  multipart: {
    note: "A valid note about the site.",
    photo: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("this is not an image") },
  },
});
check("a file that is not really an image is refused", notPng.status() === 415);
const foreign = await b.context.request.post(`${baseUrl}/api/builder/projects/${pA}/progress`, {
  multipart: { note: "Posting on someone else's project." },
});
check("another company cannot post on the project", foreign.status() === 404);
check(
  "an anonymous request is refused",
  (
    await fetch(`${baseUrl}/api/builder/projects/${pA}/progress`, {
      method: "POST",
      redirect: "manual",
    })
  ).status !== 200,
);

await act(a.page, () => a.page.getByRole("button", { name: "Delete" }).first().click());
check(
  "an update can be deleted",
  (await sql(`SELECT count(*)::int AS n FROM "ProgressUpdate"`))[0].n === 0,
);
await sql(`UPDATE "Project" SET status = 'PAUSED' WHERE id = $1`, [pA]);
await go(a.page, `/portal/projects/${pA}/progress`);
check(
  "a project that is not live cannot get updates",
  (await a.page.getByTestId("progress-not-live").count()) === 1,
);
await sql(`UPDATE "Project" SET status = 'LIVE' WHERE id = $1`, [pA]);

// =======================================================================================
section("6. Phone width");
for (const [user, route] of [
  [people.ownerA, "/portal/analytics"],
  [people.ownerA, "/portal/reviews"],
  [people.ownerA, `/portal/projects/${pA}/layout-map`],
  [people.ownerA, `/portal/projects/${pA}/progress`],
  [people.buyer, `/account/reviews/${cA}`],
  [people.admin, "/admin/reviews"],
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
