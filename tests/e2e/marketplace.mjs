// End-to-end check of the public marketplace, in a real browser, against a real Postgres.
// See docs/TESTING.md.
//
//   node tests/e2e/marketplace.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL>
//
// The server must run a production build (`npm run build && npm start`) with
// STORAGE_DRIVER=local, MAIL_DRIVER=file, ADMIN_EMAILS=admin@test.example, and an EMPTY database
// (build it against that same empty database, so the check of the home page starts from the
// "nothing live yet" state). Builders, projects and plots are inserted straight into the database
// by this script; everything buyers, builders and the admin do is done through the real pages.
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const people = {
  owner: { sub: "auth0|m-owner", email: "owner@test.example", email_verified: true, name: "Anand" },
  buyer: { sub: "auth0|m-buyer", email: "buyer@test.example", email_verified: true, name: "Bina" },
  admin: { sub: "auth0|m-admin", email: "admin@test.example", email_verified: true, name: "Root" },
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
  const page = await context.newPage();
  return { context, page };
}
const here = (page) => new URL(page.url()).pathname;
// "networkidle" alone is unreliable here: Next keeps prefetching other pages in the background.
// Wait for the page to load, give the network a short moment to go quiet, then a beat for
// hydration so clicks are not lost.
const settle = async (page) => {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(250);
};
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const html = async (route) => {
  const response = await fetch(baseUrl + route, { redirect: "manual" });
  return { status: response.status, body: await response.text(), headers: response.headers };
};
const overflows = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const cards = (page) => page.locator('[data-testid="listing-card"]');
const slugs = async (page) => cards(page).evaluateAll((els) => els.map((e) => e.dataset.slug));
const metaContent = (page, selector) =>
  page
    .locator(selector)
    .first()
    .getAttribute("content")
    .catch(() => null);

async function acceptTerms(page, startAt) {
  await page.goto(baseUrl + startAt);
  await settle(page);
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await settle(page);
  }
}

// ---------------------------------------------------------------------------------------
// data helpers (straight into the database)

async function insertBuilder(o) {
  const id = randomUUID().replace(/-/g, ""); // real ids have no hyphens
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,about,pan,gstin,"contactMobile","addressLine",city,state,
       "yearEstablished","projectsCompleted","projectsOngoing","serviceCities","interestedPlan","verifiedAt","updatedAt")
     VALUES($1,$2,$3,$4,$5,'ABCDE1234F','27AAPFU0939F1ZV','9123456780','12 Private Street',$6,'Tamil Nadu',
       2010,8,3,$7,'PREMIER',now(),now())`,
    [
      id,
      o.name,
      o.status ?? "VERIFIED",
      o.slug,
      `About ${o.name}`,
      o.city ?? "Hosur",
      [o.city ?? "Hosur"],
    ],
  );
  return id;
}
async function insertProject(o) {
  const id = randomUUID();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,description,"totalPlots",
       "pricePerSqft",amenities,"contactName","contactMobile",whatsapp,"hideContactNumber","visitingHours",
       "publishedAt","createdAt","updatedAt")
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Sales Desk',$14,$14,$15,'10 am to 6 pm',now(),
       now() - ($16::int * interval '1 minute'),now())`,
    [
      id,
      o.builderId,
      o.slug ?? null,
      o.status ?? "LIVE",
      o.name,
      o.type ?? "PLOTTED",
      o.stage ?? "READY_TO_MOVE",
      o.city,
      o.locality ?? "Main Road",
      o.description ?? `${o.name} is a test project.`,
      o.plots ?? 20,
      o.rate,
      o.amenities ?? ["park", "tar_road"],
      o.mobile ?? "9876543210",
      o.hideNumber ?? false,
      o.age ?? 0,
    ],
  );
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,"ratePerSqft",status,facing,"isCorner","updatedAt")
     SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),
       $2::int+((g%4)*200),($2::int+((g%4)*200))*$3::int,$3::int,
       (CASE WHEN g%5=0 THEN 'SOLD' WHEN g%5=1 THEN 'BOOKED' ELSE 'AVAILABLE' END)::"PlotStatus",
       (ARRAY['EAST','NORTH','WEST','SOUTH'])[1+(g%4)]::"PlotFacing", g%7=0, now()
     FROM generate_series(1,$4::int) g`,
    [id, o.size ?? 1000, o.rate, o.plots ?? 20],
  );
  if (o.approvals) {
    await sql(
      `INSERT INTO "ProjectApproval"(id,"projectId",kind,number,verified,"verifiedAt","updatedAt")
       VALUES($1,$2,'RERA','TN/29/Layout/0001/2024',true,'2026-03-05T10:00:00Z',now()),
             ($3,$2,'TNCP','DTCP 123/2024',false,null,now())`,
      [randomUUID(), id, randomUUID()],
    );
  }
  return id;
}

// ---------------------------------------------------------------------------------------
section("before anything is live");

const anon = await open(null);
await anon.page.goto(baseUrl + "/projects");
await settle(anon.page);
check(
  "an empty marketplace says it opens soon (no empty filters, no errors)",
  (await text(anon.page)).includes("The project marketplace opens soon"),
);
await anon.page.goto(baseUrl + "/");
await settle(anon.page);
check(
  "home page shows labelled sample projects while nothing is live",
  (await text(anon.page)).includes("sample listings"),
);
for (const route of [
  "/project/nothing-here",
  "/builder/nobody",
  "/projects/atlantis",
  "/projects/atlantis/plots",
]) {
  const response = await html(route);
  check(`${route} is a 404`, response.status === 404, String(response.status));
}
const sitemapEmpty = await html("/sitemap.xml");
check(
  "sitemap works with no projects and lists the fixed pages",
  sitemapEmpty.status === 200 && sitemapEmpty.body.includes("/for-builders"),
  String(sitemapEmpty.status),
);

// ---------------------------------------------------------------------------------------
section("seeding the database");

const builderA = await insertBuilder({ name: "Anand Realty", slug: "anand-realty", city: "Hosur" });
const builderB = await insertBuilder({
  name: "Suspended Estates",
  slug: "suspended-estates",
  status: "SUSPENDED",
});

const P = {};
P.green = await insertProject({
  builderId: builderA,
  slug: "green-valley-enclave",
  name: "Green Valley Enclave",
  city: "Hosur",
  locality: "Bagalur Road",
  rate: 1850,
  size: 1000,
  plots: 20,
  approvals: true,
  age: 10,
  amenities: ["park", "tar_road", "street_lights"],
});
P.lake = await insertProject({
  builderId: builderA,
  slug: "lakeview-farm-retreat",
  name: "Lakeview Farm Retreat",
  city: "Hosur",
  type: "FARM_HOUSE",
  stage: "UNDER_CONSTRUCTION",
  rate: 950,
  size: 4400,
  plots: 12,
  hideNumber: true,
  mobile: "9876500001",
  age: 20,
});
P.sky = await insertProject({
  builderId: builderA,
  slug: "skyline-heights",
  name: "Skyline Heights",
  city: "Coimbatore",
  type: "RESIDENTIAL",
  stage: "PRE_LAUNCH",
  rate: 6200,
  size: 950,
  plots: 16,
  age: 30,
});
P.metro = await insertProject({
  builderId: builderA,
  slug: "metro-business-park",
  name: "Metro Business Park",
  city: "Chennai",
  type: "COMMERCIAL",
  stage: "UNDER_CONSTRUCTION",
  rate: 11500,
  size: 450,
  plots: 16,
  age: 40,
});
P.evil = await insertProject({
  builderId: builderA,
  slug: "evil-plaza",
  name: "Evil </script><script>window.__pwn=1</script> Plaza",
  city: "Hosur",
  type: "COMMERCIAL",
  rate: 20000,
  size: 1000,
  plots: 6,
  age: 50,
});
// never public
P.draft = await insertProject({
  builderId: builderA,
  status: "DRAFT",
  name: "Secret Draft Layout",
  city: "Hosur",
  rate: 1000,
});
P.paused = await insertProject({
  builderId: builderA,
  slug: "paused-layout",
  status: "PAUSED",
  name: "Paused Layout",
  city: "Hosur",
  rate: 1000,
});
P.hiddenBuilder = await insertProject({
  builderId: builderB,
  slug: "suspended-live",
  name: "Suspended Builders Layout",
  city: "Hosur",
  rate: 1000,
});
// fourteen more in Salem, for pagination
for (let i = 1; i <= 14; i++) {
  await insertProject({
    builderId: builderA,
    slug: `filler-${i}`,
    name: `Filler Layout ${i}`,
    city: "Salem",
    rate: 1500,
    size: 1000,
    plots: 5,
    age: 100 + i,
  });
}

await sql(
  `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,$2,$3,'Anand','BUILDER_OWNER',now())`,
  [randomUUID(), people.owner.sub, people.owner.email],
);
const [ownerRow] = await sql(`SELECT id FROM "User" WHERE "auth0Sub"=$1`, [people.owner.sub]);
await sql(`INSERT INTO "BuilderMember"(id,"builderId","userId",role) VALUES($1,$2,$3,'OWNER')`, [
  randomUUID(),
  builderA,
  ownerRow.id,
]);

// ---------------------------------------------------------------------------------------
section("what is public, and what is not");

await anon.page.goto(baseUrl + "/projects");
await settle(anon.page);
const all = new Set();
let total = await anon.page.getByTestId("result-count").innerText();
check("the marketplace counts 19 public projects", total.startsWith("19 projects"), total);
check("12 cards on the first page", (await cards(anon.page).count()) === 12);
{
  const raw = await html("/projects");
  check(
    "the server's HTML for the list already holds the 12 project cards",
    (raw.body.match(/data-testid="listing-card"/g) ?? []).length === 12,
  );
}
for (const slug of await slugs(anon.page)) all.add(slug);
await anon.page.getByRole("link", { name: "Next", exact: true }).click();
await anon.page.waitForURL(/page=2/);
await settle(anon.page);
check(
  "the second page has the remaining 7",
  (await cards(anon.page).count()) === 7,
  String(await cards(anon.page).count()),
);
for (const slug of await slugs(anon.page)) all.add(slug);
check(
  "drafts, paused projects and suspended builders never appear",
  !["paused-layout", "suspended-live"].some((s) => all.has(s)) && ![...all].some((s) => !s),
);
check(
  "page 2 is not indexed and points to the main list",
  (await metaContent(anon.page, 'meta[name="robots"]'))?.includes("noindex") &&
    (await anon.page.locator('link[rel="canonical"]').getAttribute("href")) ===
      baseUrl + "/projects",
);
await anon.page.goto(baseUrl + "/projects?page=99");
await settle(anon.page);
check(
  "a page past the end is a friendly empty state, not an error",
  (await text(anon.page)).includes("past the last result"),
);

for (const [route, status] of [
  ["/project/secret-draft", 404],
  ["/project/paused-layout", 404],
  ["/project/suspended-live", 404],
  ["/builder/suspended-estates", 404],
]) {
  const response = await html(route);
  check(`${route} is hidden (${status})`, response.status === status, String(response.status));
}
const draftSearch = await html("/projects?q=Secret");
check(
  "a draft's name cannot be found by searching",
  !draftSearch.body.includes("Secret Draft Layout"),
);

// ---------------------------------------------------------------------------------------
section("search, filters and sorting");

await anon.page.goto(baseUrl + "/projects?q=hosur");
await settle(anon.page);
check(
  "searching a city finds only projects there",
  JSON.stringify((await slugs(anon.page)).sort()) ===
    JSON.stringify(["evil-plaza", "green-valley-enclave", "lakeview-farm-retreat"]),
  JSON.stringify(await slugs(anon.page)),
);
await anon.page.goto(baseUrl + "/projects?q=hosur&max=2500000");
await settle(anon.page);
check(
  "city plus a budget ceiling finds the right project",
  JSON.stringify(await slugs(anon.page)) === JSON.stringify(["green-valley-enclave"]),
  JSON.stringify(await slugs(anon.page)),
);
await anon.page.goto(baseUrl + "/projects?type=farm-houses");
await settle(anon.page);
check(
  "type filter",
  JSON.stringify(await slugs(anon.page)) === JSON.stringify(["lakeview-farm-retreat"]),
);
await anon.page.goto(baseUrl + "/projects?type=plots&type=commercial&q=hosur");
await settle(anon.page);
check("two types together", (await cards(anon.page).count()) === 2);
await anon.page.goto(baseUrl + "/projects?approval=rera&verified=1");
await settle(anon.page);
check(
  "verified approval filter",
  JSON.stringify(await slugs(anon.page)) === JSON.stringify(["green-valley-enclave"]),
);
await anon.page.goto(baseUrl + "/projects?amenity=street_lights");
await settle(anon.page);
check(
  "amenity filter",
  JSON.stringify(await slugs(anon.page)) === JSON.stringify(["green-valley-enclave"]),
);
await anon.page.goto(baseUrl + "/projects?facing=south&q=skyline");
await settle(anon.page);
check(
  "facing filter looks at plots that are still available",
  (await cards(anon.page).count()) === 1,
);
await anon.page.goto(baseUrl + "/projects?sort=price_asc");
await settle(anon.page);
check(
  "cheapest first starts with a Salem layout",
  (await slugs(anon.page))[0]?.startsWith("filler-"),
  JSON.stringify(await slugs(anon.page)),
);
await anon.page.goto(baseUrl + "/projects?sort=price_desc");
await settle(anon.page);
check(
  "dearest first starts with the Evil Plaza",
  (await slugs(anon.page))[0] === "evil-plaza",
  JSON.stringify(await slugs(anon.page)),
);
await anon.page.goto(baseUrl + "/projects?sort=bogus%3BDROP&min=abc&page=-4&type=nonsense");
await settle(anon.page);
check(
  "garbage in the address is ignored, not an error",
  (await anon.page.getByTestId("result-count").innerText()).startsWith("19"),
);

const injected = await html("/projects?q=" + encodeURIComponent(`'; DROP TABLE "Project"; --`));
check("an SQL injection attempt is just a search that finds nothing", injected.status === 200);
const [{ count: stillThere }] = await sql(`SELECT count(*)::int AS count FROM "Project"`);
check("and the Project table is still there", stillThere === 22, String(stillThere));
await anon.page.goto(baseUrl + "/projects?q=%25");
await settle(anon.page);
check(
  "a percent sign is searched for literally, not as a wildcard",
  (await text(anon.page)).includes("No projects found"),
);
await anon.page.goto(
  baseUrl + "/projects?q=" + encodeURIComponent("<img src=x onerror=window.__pwn2=1>"),
);
check(
  "script in the search box is shown as text and never runs",
  (await anon.page.evaluate(() => window.__pwn2)) === undefined,
);

section("city pages");
await anon.page.goto(baseUrl + "/projects/hosur");
await settle(anon.page);
check("a city page lists that city's projects", (await cards(anon.page).count()) === 3);
check(
  "a city page is indexed with itself as canonical",
  (await metaContent(anon.page, 'meta[name="robots"]'))?.includes("noindex") !== true &&
    (await anon.page.locator('link[rel="canonical"]').getAttribute("href")) ===
      baseUrl + "/projects/hosur",
);
await anon.page.goto(baseUrl + "/projects/HOSUR/plots");
await settle(anon.page);
check(
  "city and type page (and the slug is case-insensitive)",
  JSON.stringify(await slugs(anon.page)) === JSON.stringify(["green-valley-enclave"]),
  JSON.stringify(await slugs(anon.page)),
);
await anon.page.goto(baseUrl + "/projects/hosur?q=lake");
await settle(anon.page);
check(
  "a filtered city page is not indexed and keeps the plain page as canonical",
  (await metaContent(anon.page, 'meta[name="robots"]'))?.includes("noindex") &&
    (await anon.page.locator('link[rel="canonical"]').getAttribute("href")) ===
      baseUrl + "/projects/hosur",
);
await anon.page.goto(baseUrl + "/projects/hosur?city=Chennai");
await settle(anon.page);
check(
  "the city in the address cannot be overridden on a city page",
  (await cards(anon.page).count()) === 3,
);
for (const route of [
  "/projects/hosur/spaceships",
  "/projects/trichy",
  "/projects/atlantis/plots",
]) {
  const response = await html(route);
  check(
    `${route} is a real 404, not a 200 page that says not found`,
    response.status === 404,
    String(response.status),
  );
}

// ---------------------------------------------------------------------------------------
section("the project page");

const res = await html("/project/green-valley-enclave");
check("the project page loads", res.status === 200, String(res.status));
{
  // What search engines and link previews read: the server's HTML, before any script runs.
  const visibleText = res.body
    .slice(res.body.indexOf("<body"))
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  for (const want of [
    "Green Valley Enclave",
    "Bagalur Road, Hosur",
    "Plots and availability",
    "A-1",
    "Anand Realty",
    "Verified on 5 Mar 2026",
    "Street lights",
    "Pricing details",
  ]) {
    check(`the server's HTML already contains "${want}"`, visibleText.includes(want));
  }
}
await anon.page.goto(baseUrl + "/project/green-valley-enclave");
await settle(anon.page);
const body = await text(anon.page);
check(
  "shows name, place and price range",
  body.includes("Green Valley Enclave") &&
    body.includes("Bagalur Road, Hosur") &&
    /₹18\.5 L|₹1\.85 Cr|18\.5 L/.test(body),
  body.slice(0, 300),
);
check(
  "shows the builder with a link to the builder page",
  (await anon.page.getByRole("link", { name: "Anand Realty" }).first().getAttribute("href")) ===
    "/builder/anand-realty",
);
check(
  "shows the approvals panel with the verification date",
  body.includes("Verified on 5 Mar 2026") && body.includes("Not yet verified by RKB"),
);
check("shows amenities", body.includes("Street lights"));
const canonical = await anon.page.locator('link[rel="canonical"]').getAttribute("href");
check(
  "canonical address is the project's own",
  canonical === baseUrl + "/project/green-valley-enclave",
  String(canonical),
);
check(
  "page title carries name and place",
  (await anon.page.title()).startsWith("Green Valley Enclave, Bagalur Road, Hosur"),
  await anon.page.title(),
);
check(
  "open graph title and description exist for WhatsApp previews",
  Boolean(await metaContent(anon.page, 'meta[property="og:title"]')) &&
    (await metaContent(anon.page, 'meta[property="og:description"]'))?.includes("Anand Realty"),
);

const ld = await anon.page.locator('script[type="application/ld+json"]').allTextContents();
let graph;
try {
  graph = JSON.parse(ld[0])["@graph"];
} catch {}
const product = graph?.find((n) => n["@type"] === "Product");
const crumbs = graph?.find((n) => n["@type"] === "BreadcrumbList");
check(
  "structured data is valid JSON with a product and breadcrumbs",
  Boolean(product && crumbs && crumbs.itemListElement.length === 4),
);
check(
  "structured data price matches the plots (₹18.5 L lowest)",
  product?.offers?.lowPrice === 1850000 && product?.offers?.priceCurrency === "INR",
  JSON.stringify(product?.offers),
);

check(
  "contact card offers a call link with the builder's number",
  (await anon.page.getByTestId("call-builder").first().getAttribute("href")) ===
    "tel:+919876543210",
);
check(
  "and a WhatsApp link with the project name",
  decodeURIComponent(
    (await anon.page.getByTestId("whatsapp-builder").first().getAttribute("href")) ?? "",
  ).includes("Green Valley Enclave"),
);

// plot table
const table = anon.page.getByTestId("plot-table");
const rows = () => table.locator("tbody tr[data-status]");
check("plot table lists every plot", (await rows().count()) === 20);
check(
  "status chips show live counts",
  (await table.innerText()).includes("Available (12)") &&
    (await table.innerText()).includes("Booked (4)") &&
    (await table.innerText()).includes("Sold (4)"),
);
await table.getByRole("button", { name: /^Available/ }).click();
check(
  "the Available chip shows only available plots",
  (await rows().count()) === 12 &&
    (await rows().evaluateAll((r) => r.every((x) => x.dataset.status === "AVAILABLE"))),
);
await table.getByRole("button", { name: /^Sold/ }).click();
check("the Sold chip shows only sold plots", (await rows().count()) === 4);
await table.getByRole("button", { name: /^All/ }).click();
await table.getByPlaceholder("Find a plot").fill("A-1");
check(
  "finding a plot by number (A-1 and A-10 to A-19)",
  (await rows().count()) === 11,
  String(await rows().count()),
);
await table.getByPlaceholder("Find a plot").fill("zzz");
check("no match says so", (await table.innerText()).includes("No plots match"));

// tabs
await anon.page
  .getByRole("navigation", { name: "On this page" })
  .getByRole("link", { name: "Approvals" })
  .click();
check(
  "the Approvals tab jumps to its section",
  (await anon.page.evaluate(() => location.hash)) === "#approvals",
);

check("nothing overflows sideways on desktop", !(await overflows(anon.page)));

// hidden contact number
section("pages are cached");
const cachedFirst = await html("/project/skyline-heights");
await sql(`UPDATE "Project" SET description='CHANGED-BY-SQL-MARKER' WHERE slug='skyline-heights'`);
const cachedSecond = await html("/project/skyline-heights");
check(
  "a project page is served from the cache (a change made behind the app's back waits for the refresh)",
  cachedFirst.status === 200 && !cachedSecond.body.includes("CHANGED-BY-SQL-MARKER"),
);
await sql(
  `UPDATE "Project" SET description='Skyline Heights is a test project.' WHERE slug='skyline-heights'`,
);

section("a builder who hides the phone number");
const hidden = await html("/project/lakeview-farm-retreat");
check(
  "their number is nowhere in the page, including data sent to the browser",
  hidden.status === 200 &&
    hidden.body.includes("Lakeview Farm Retreat") &&
    !hidden.body.includes("9876500001"),
);
await anon.page.goto(baseUrl + "/project/lakeview-farm-retreat");
await settle(anon.page);
check(
  "no call link; enquiries go through RKB",
  (await anon.page.locator('a[href^="tel:"]').count()) === 0 &&
    (await text(anon.page)).includes("takes enquiries through RKB"),
);
const green = await html("/project/green-valley-enclave");
check(
  "(the page checked below really is the full project page)",
  green.body.includes("Plots and availability"),
);
for (const secret of ["ABCDE1234F", "27AAPFU0939F1ZV", "12 Private Street", "9123456780"]) {
  check(
    `the builder's private detail ${secret} is not on the project page`,
    !green.body.includes(secret),
  );
}

// injection
section("a project name that tries to break out of the page");
await anon.page.goto(baseUrl + "/project/evil-plaza");
await settle(anon.page);
check(
  "script in a project name does not run",
  (await anon.page.evaluate(() => window.__pwn)) === undefined,
);
const evilLd = JSON.parse(
  (await anon.page.locator('script[type="application/ld+json"]').allTextContents())[0],
);
check(
  "and structured data still parses, with the name intact",
  evilLd["@graph"].find((n) => n["@type"] === "Product").name.includes("</script>"),
);
const evilHtml = await html("/project/evil-plaza");
check(
  "the raw page never contains a live script tag from the name",
  evilHtml.body.includes("Plaza") && !evilHtml.body.includes("<script>window.__pwn"),
);

// ---------------------------------------------------------------------------------------
section("the builder page");
const builderPage = await html("/builder/anand-realty");
check(
  "builder page loads with its content in the server's HTML",
  builderPage.status === 200 &&
    builderPage.body.includes("About Anand Realty") &&
    builderPage.body.includes("Green Valley Enclave"),
);
for (const secret of ["ABCDE1234F", "27AAPFU0939F1ZV", "12 Private Street", "9123456780"]) {
  check(`the builder page does not leak ${secret}`, !builderPage.body.includes(secret));
}
await anon.page.goto(baseUrl + "/builder/anand-realty");
await settle(anon.page);
const bText = await text(anon.page);
check(
  "builder page shows the verified badge, story and projects",
  bText.includes("Anand Realty") &&
    bText.includes("About Anand Realty") &&
    bText.includes("Verified") &&
    (await cards(anon.page).count()) === 19,
  String(await cards(anon.page).count()),
);
check(
  "builder page has Organization structured data",
  (await anon.page.locator('script[type="application/ld+json"]').allTextContents())
    .join()
    .includes('"Organization"'),
);

// ---------------------------------------------------------------------------------------
section("SEO files and the installable app");
const sitemap = await html("/sitemap.xml");
for (const want of [
  "/project/green-valley-enclave",
  "/builder/anand-realty",
  "/projects/hosur</loc>",
  "/projects/hosur/plots",
  "/projects/salem",
]) {
  check(`sitemap lists ${want}`, sitemap.body.includes(want));
}
for (const bad of ["paused-layout", "suspended-live", "suspended-estates", "secret-draft"]) {
  check(`sitemap does not list ${bad}`, !sitemap.body.includes(bad));
}
const robots = await html("/robots.txt");
check(
  "robots.txt points at the sitemap and keeps private areas out",
  robots.body.includes("Sitemap:") &&
    robots.body.includes("Disallow: /account") &&
    robots.body.includes("Disallow: /portal"),
);
const manifest = await html("/manifest.webmanifest");
const manifestJson = JSON.parse(manifest.body);
check(
  "web app manifest is valid with 192 and 512 icons",
  manifestJson.display === "standalone" &&
    manifestJson.icons.some((i) => i.sizes === "192x192") &&
    manifestJson.icons.some((i) => i.sizes === "512x512"),
);
for (const icon of ["/pwa-icon/192", "/pwa-icon/512", "/apple-icon", "/icon"]) {
  const r = await fetch(baseUrl + icon);
  check(
    `${icon} is a PNG`,
    r.status === 200 && (r.headers.get("content-type") ?? "").includes("image/png"),
    `${r.status} ${r.headers.get("content-type")}`,
  );
}
check("only the known icon sizes are generated", (await html("/pwa-icon/99999")).status === 404);

// ---------------------------------------------------------------------------------------
section("on a phone: find, open, filter plots, save, share");

const phone = await open(null, PHONE);
const pp = phone.page;
await pp.addInitScript(() => {
  navigator.share = async (data) => {
    window.__shared = data;
  };
});
await pp.goto(baseUrl + "/");
await settle(pp);
check("the home page has no sideways scroll on a phone", !(await overflows(pp)));
await pp.getByPlaceholder("City or locality").fill("Hosur");
await pp.locator('select[name="budget"]').selectOption("0-2500000");
await pp.getByRole("button", { name: "Search" }).click();
await pp.waitForURL(/\/projects\?/);
await settle(pp);
check(
  "home search lands on results for that city and budget",
  JSON.stringify(await slugs(pp)) === JSON.stringify(["green-valley-enclave"]),
  JSON.stringify(await slugs(pp)),
);
check("results page has no sideways scroll on a phone", !(await overflows(pp)));
await pp.getByRole("link", { name: "Green Valley Enclave" }).first().click();
await pp.waitForURL(/\/project\/green-valley-enclave/);
await settle(pp);
check("tapping a card opens the project", here(pp) === "/project/green-valley-enclave");
check("project page has no sideways scroll on a phone", !(await overflows(pp)));
const bar = pp.getByTestId("mobile-contact-bar");
check("a call bar is pinned to the bottom on a phone", await bar.isVisible());
check("with a call link", (await bar.locator('a[href^="tel:"]').count()) === 1);
const pt = pp.getByTestId("plot-table");
await pt.scrollIntoViewIfNeeded();
await pt
  .getByRole("button", { name: /^Available/ })
  .tap()
  .catch(async () => pt.getByRole("button", { name: /^Available/ }).click());
check(
  "filtering plots to Available works on a phone",
  (await pt.locator("tbody tr[data-status]").count()) === 12,
);
check("the plot table scrolls inside itself, not the page", !(await overflows(pp)));
await pp.getByRole("button", { name: "Share" }).click();
const shared = await pp.evaluate(() => window.__shared);
check(
  "Share hands the project address to the phone's share sheet",
  shared?.url === baseUrl + "/project/green-valley-enclave" &&
    shared?.title === "Green Valley Enclave",
  JSON.stringify(shared),
);

const loginRequest = pp
  .waitForRequest((r) => r.url().includes("/auth/login?returnTo="), { timeout: 15000 })
  .catch(() => null);
await pp.getByRole("button", { name: /^Save Green Valley Enclave/ }).click();
const request = await loginRequest;
check(
  "saving while logged out sends you to log in and back to this page",
  request !== null &&
    decodeURIComponent(request.url()).includes("returnTo=/project/green-valley-enclave"),
  request?.url(),
);

// share fallback: WhatsApp
const noShare = await open(null, PHONE);
await noShare.page.addInitScript(() => {
  Object.defineProperty(navigator, "share", { value: undefined });
});
await noShare.page.goto(baseUrl + "/project/green-valley-enclave");
await settle(noShare.page);
const popup = noShare.page.waitForEvent("popup", { timeout: 10000 }).catch(() => null);
await noShare.page.getByRole("button", { name: "Share" }).click();
const wa = await popup;
check(
  "without a share sheet, Share opens WhatsApp with the link",
  wa !== null &&
    /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(wa.url()) &&
    decodeURIComponent(wa.url()).includes("/project/green-valley-enclave"),
  wa?.url(),
);
await wa?.close();
await noShare.context.close();

// filters form on a phone
await pp.goto(baseUrl + "/projects");
await settle(pp);
await pp
  .getByText(/^Filters/)
  .first()
  .click();
await pp.getByLabel("Search", { exact: true }).fill("Chennai");
await pp.getByRole("button", { name: "Show results" }).click();
await pp.waitForURL(/q=Chennai/);
check(
  "the filters panel works on a phone",
  JSON.stringify(await slugs(pp)) === JSON.stringify(["metro-business-park"]),
  JSON.stringify(await slugs(pp)),
);
check("filter panel does not cause sideways scroll", !(await overflows(pp)));

// recently viewed
await pp.goto(baseUrl + "/projects");
await settle(pp);
check(
  "Recently viewed remembers what you opened (in this browser only)",
  (await text(pp)).includes("Recently viewed") && (await text(pp)).includes("Green Valley Enclave"),
);
await phone.context.close();

// ---------------------------------------------------------------------------------------
section("saved projects (logged in)");

const buyer = await open(people.buyer);
const bp = buyer.page;
const unauth = await anon.context.request.get(baseUrl + "/api/shortlist");
check(
  "anonymous visitors get a calm answer, not an error",
  unauth.status() === 200 && (await unauth.json()).authenticated === false,
);
const anonPost = await anon.context.request.post(baseUrl + "/api/shortlist", {
  data: { projectId: P.green, saved: true },
});
check("anonymous visitors cannot save", anonPost.status() === 401, String(anonPost.status()));

await acceptTerms(bp, "/account");
await bp.goto(baseUrl + "/project/green-valley-enclave");
await settle(bp);
const heart = bp
  .getByRole("button", { name: /Green Valley Enclave/, includeHidden: false })
  .filter({ hasText: /Save|Saved/ })
  .first();
await heart.click();
await bp.waitForFunction(() => document.querySelector('button[aria-pressed="true"]'), null, {
  timeout: 10000,
});
check(
  "tapping Save turns the heart on at once",
  (await heart.getAttribute("aria-pressed")) === "true",
);
await bp.reload();
await settle(bp);
await bp
  .waitForFunction(() => document.querySelector('button[aria-pressed="true"]'), null, {
    timeout: 10000,
  })
  .catch(() => {});
check(
  "and it is still saved after a reload",
  (await heart.getAttribute("aria-pressed")) === "true",
);

await bp.goto(baseUrl + "/projects?q=hosur");
await settle(bp);
await bp
  .waitForFunction(
    () => document.querySelector('[data-testid="shortlist-heart"][aria-pressed="true"]'),
    null,
    { timeout: 10000 },
  )
  .catch(() => {});
const pressed = await bp
  .locator('[data-testid="listing-card"]')
  .evaluateAll((els) =>
    els.filter((e) => e.querySelector('[aria-pressed="true"]')).map((e) => e.dataset.slug),
  );
check(
  "search results show the same heart as filled",
  JSON.stringify(pressed) === JSON.stringify(["green-valley-enclave"]),
  JSON.stringify(pressed),
);

await bp.goto(baseUrl + "/account/shortlist");
check(
  "the Saved page lists the project",
  JSON.stringify(await slugs(bp)) === JSON.stringify(["green-valley-enclave"]),
  JSON.stringify(await slugs(bp)),
);
check(
  "the account page links to it",
  (await (async () => {
    await bp.goto(baseUrl + "/account");
    return bp.getByRole("link", { name: "Saved projects", exact: true }).count();
  })()) === 1,
);

const api = buyer.context.request;
const jsonHeaders = { "Content-Type": "application/json" };
const saveDraft = await api.post(baseUrl + "/api/shortlist", {
  data: { projectId: P.draft, saved: true },
  headers: jsonHeaders,
});
check(
  "a draft cannot be saved (it would reveal it exists)",
  saveDraft.status() === 404,
  String(saveDraft.status()),
);
const saveHidden = await api.post(baseUrl + "/api/shortlist", {
  data: { projectId: P.hiddenBuilder, saved: true },
  headers: jsonHeaders,
});
check(
  "a suspended builder's project cannot be saved",
  saveHidden.status() === 404,
  String(saveHidden.status()),
);
const badBody = await api.post(baseUrl + "/api/shortlist", {
  data: "projectId=1&saved=true",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
});
check(
  "a form post (the shape a cross-site attack would use) is refused",
  badBody.status() >= 400 && badBody.status() < 500,
  String(badBody.status()),
);
const junk = await api.post(baseUrl + "/api/shortlist", {
  data: { projectId: { $gt: "" }, saved: "yes" },
  headers: jsonHeaders,
});
check(
  "malformed JSON values are refused",
  junk.status() >= 400 && junk.status() < 500,
  String(junk.status()),
);
const listed = await (await api.get(baseUrl + "/api/shortlist")).json();
check(
  "the list still holds only the one real project",
  listed.ids.length === 1 && listed.ids[0] === P.green,
);

// ---------------------------------------------------------------------------------------
section("changes by the builder and admin show up for buyers straight away");

// Prime the cached copies, so a stale page would be served if nothing refreshed them.
await html("/project/green-valley-enclave");
await html("/project/green-valley-enclave");
await html("/project/lakeview-farm-retreat");
await html("/project/lakeview-farm-retreat");
await html("/");

const owner = await open(people.owner);
const op = owner.page;
await acceptTerms(op, "/portal");
const ownerList = await (await owner.context.request.get(baseUrl + "/api/shortlist")).json();
check(
  "saved lists are private: another user sees none of the buyer's",
  ownerList.authenticated === true && ownerList.ids.length === 0,
  JSON.stringify(ownerList),
);
await op.goto(baseUrl + `/portal/projects/${P.green}/plots`);
await settle(op);
await op.locator('[data-plot-number="A-3"] select').selectOption("SOLD");
await op
  .waitForFunction(
    () => /Sold\s*5/.test(document.querySelector('[data-testid="plot-counts"]')?.textContent ?? ""),
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
await op.waitForTimeout(500);

await anon.page.goto(baseUrl + "/project/green-valley-enclave");
await settle(anon.page);
const afterSale = await anon.page.getByTestId("plot-table").innerText();
check(
  "a plot the builder marks sold shows as sold on the public page at once",
  afterSale.includes("Available (11)") && afterSale.includes("Sold (5)"),
  afterSale.slice(0, 120),
);

const upload = async (n) =>
  owner.context.request.post(baseUrl + `/api/builder/projects/${P.green}/upload`, {
    multipart: { kind: "PHOTO", file: { name: `p${n}.png`, mimeType: "image/png", buffer: PNG } },
  });
for (const n of [1, 2, 3]) {
  const r = await upload(n);
  if (r.status() !== 200) check(`photo ${n} uploads`, false, `${r.status()} ${await r.text()}`);
}
await anon.page.goto(baseUrl + "/project/green-valley-enclave");
await settle(anon.page);
check(
  "photos added by the builder appear on the public page at once",
  (await anon.page.locator('button[aria-label^="Open photo 1 of 3"]').count()) === 1,
);

// gallery lightbox
await anon.page.locator('button[aria-label^="Open photo 1 of 3"]').click();
const dialog = anon.page.getByRole("dialog");
check("clicking a photo opens the full-screen viewer", await dialog.isVisible());
check("which says 1 / 3", (await dialog.innerText()).includes("1 / 3"));
check(
  "and the picture really loads (not a broken image)",
  await dialog.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0),
);
await anon.page.keyboard.press("ArrowRight");
check("the right arrow key moves to the next photo", (await dialog.innerText()).includes("2 / 3"));
await anon.page.keyboard.press("ArrowLeft");
await anon.page.keyboard.press("ArrowLeft");
check("and wraps around from the first to the last", (await dialog.innerText()).includes("3 / 3"));
await anon.page.keyboard.press("Escape");
check("Escape closes the viewer", !(await dialog.isVisible()));

await anon.page.goto(baseUrl + "/");
await settle(anon.page);
const homeText = await text(anon.page);
check(
  "the home page now shows real projects instead of samples",
  homeText.includes("Latest projects") && !homeText.includes("sample listings"),
  homeText.slice(0, 80),
);
{
  const raw = await html("/");
  check(
    "the home page's server HTML holds the real project cards",
    raw.body.includes('data-testid="listing-card"') && raw.body.includes("Latest projects"),
  );
}
check("and the city links", (await anon.page.getByRole("link", { name: /^Hosur/ }).count()) >= 1);

// admin pauses a project
const admin = await open(people.admin);
await acceptTerms(admin.page, "/admin");
await admin.page.goto(baseUrl + `/admin/projects/${P.lake}`);
await settle(admin.page);
await admin.page.locator("#pause-note").fill("Paused during the marketplace check");
await admin.page.getByRole("button", { name: "Pause listing" }).click();
await admin.page.waitForURL(/saved=/);
const afterPause = await html("/project/lakeview-farm-retreat");
check(
  "a project the admin pauses disappears from its public page at once",
  afterPause.status === 404,
  String(afterPause.status),
);
await anon.page.goto(baseUrl + "/");
await settle(anon.page);
check(
  "and from the home page's project cards",
  !(await slugs(anon.page)).includes("lakeview-farm-retreat"),
  JSON.stringify(await slugs(anon.page)),
);
const sm2 = await html("/sitemap.xml");
check("and from the sitemap", !sm2.body.includes("lakeview-farm-retreat"));

// resume
await admin.page.goto(baseUrl + `/admin/projects/${P.lake}`);
await settle(admin.page);
await admin.page.getByRole("button", { name: "Resume listing" }).click();
await admin.page.waitForURL(/saved=/);
check("resuming brings it back", (await html("/project/lakeview-farm-retreat")).status === 200);

// builder suspended
await sql(`UPDATE "Builder" SET status='SUSPENDED' WHERE id=$1`, [builderA]);
const suspendedSearch = await html("/projects?q=green");
check(
  "when a builder is suspended, their projects leave search at once",
  !suspendedSearch.body.includes("green-valley-enclave"),
);
await sql(`UPDATE "Builder" SET status='VERIFIED' WHERE id=$1`, [builderA]);

// ---------------------------------------------------------------------------------------
section("other pages at phone width");
const sweep = await open(people.buyer, PHONE);
for (const route of [
  "/",
  "/projects",
  "/projects/hosur",
  "/projects/hosur/plots",
  "/project/green-valley-enclave",
  "/project/lakeview-farm-retreat",
  "/builder/anand-realty",
  "/account/shortlist",
  "/pricing",
  "/for-builders",
]) {
  await sweep.page.goto(baseUrl + route);
  await settle(sweep.page);
  check(`${route} fits a 390px screen`, !(await overflows(sweep.page)));
}
await sweep.context.close();

await browser.close();
await db.end();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
