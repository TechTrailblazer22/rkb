// End-to-end check of the site's defences, in a real browser against a real Postgres: security
// headers, that the Content-Security-Policy does not break any page, the branded not-found page, the
// buyer's right to a copy of their data and to erasure, and a handful of attacks that must fail.
// See docs/SECURITY.md.
//
//   node tests/e2e/hardening.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL>
//
// The server must run a production build with STORAGE_DRIVER=local, ADMIN_EMAILS=admin@test.example
// and an EMPTY database.
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
  sub: `auth0|h-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  owner: person("owner", "Owner"),
  buyer: person("buyer", "Asha Kumar"),
  other: person("other", "Ravi Shankar"),
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
async function open(user) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  if (user) await context.addCookies([await cookieFor(user)]);
  const page = await context.newPage();
  const violations = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text()))
      violations.push(m.text().slice(0, 200));
  });
  return { context, page, violations };
}
const settle = async (page) => {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(400);
};
const here = (page) => new URL(page.url()).pathname;
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
async function go(page, route) {
  await page.goto(baseUrl + route);
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((u) => u.pathname !== "/welcome");
    await page.goto(baseUrl + route);
  }
  await settle(page);
}

// ---------------------------------------------------------------------------------------
const builderId = id();
await sql(
  `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,'Alpha Builders','VERIFIED','alpha',now(),now())`,
  [builderId],
);
await sql(
  `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,'PREMIER','COMP',now(),now()+interval '60 days',now())`,
  [id(), builderId],
);
const ownerId = id();
await sql(
  `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,$2,$3,$4,'BUILDER_OWNER',now())`,
  [ownerId, people.owner.sub, people.owner.email, people.owner.name],
);
await sql(`INSERT INTO "BuilderMember"(id,"builderId","userId",role) VALUES($1,$2,$3,'OWNER')`, [
  id(),
  builderId,
  ownerId,
]);
const projectId = id();
await sql(
  `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"videoUrl","tourUrl","contactMobile","publishedAt","updatedAt") VALUES($1,$2,'alpha-one','LIVE','Alpha One','PLOTTED','READY_TO_MOVE','Hosur','Main Road','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://my.matterport.com/show/?m=abc','9876543210',now(),now())`,
  [projectId, builderId],
);
const plots = [];
for (let g = 1; g <= 3; g++) {
  const plotId = id();
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt") VALUES($1,$2,$3,$4,1000,1850000,'AVAILABLE',now())`,
    [plotId, projectId, `A-${g}`, `a-0000000${g}`],
  );
  plots.push(plotId);
}
for (const [g, plotId] of plots.entries()) {
  await sql(
    `INSERT INTO "LayoutShape"(id,"projectId","plotId",x,y,w,h,"updatedAt") VALUES($1,$2,$3,$4,10,12,10,now())`,
    [id(), projectId, plotId, 10 + g * 20],
  );
}
await sql(
  `INSERT INTO "ProgressUpdate"(id,"projectId",note,"createdById") VALUES($1,$2,'Roads laid in phase one.',$3)`,
  [id(), projectId, ownerId],
);

// =======================================================================================
section("1. Security headers");
const home = await fetch(baseUrl + "/");
const h = (name) => home.headers.get(name) ?? "";
check(
  "a content security policy is sent",
  h("content-security-policy").includes("default-src 'self'"),
);
check(
  "it forbids embedding the site in a frame, plugins and a changed base address",
  h("content-security-policy").includes("frame-ancestors 'none'") &&
    h("content-security-policy").includes("object-src 'none'") &&
    h("content-security-policy").includes("base-uri 'self'"),
);
check(
  "it names the payment and video services it needs, and no wildcard script source",
  h("content-security-policy").includes("https://checkout.razorpay.com") &&
    h("content-security-policy").includes("youtube-nocookie.com") &&
    !/script-src[^;]*\*/.test(h("content-security-policy")),
);
check("it allows no eval in production", !h("content-security-policy").includes("'unsafe-eval'"));
check(
  "nosniff, frame denial, referrer and permissions policies are set",
  h("x-content-type-options") === "nosniff" &&
    h("x-frame-options") === "DENY" &&
    h("referrer-policy") === "strict-origin-when-cross-origin" &&
    h("permissions-policy").includes("camera=()"),
);
check("the server does not announce what it runs", home.headers.get("x-powered-by") === null);
check("HTTPS is required from now on", h("strict-transport-security").includes("max-age=63072000"));
for (const route of ["/api/health", "/projects", "/project/alpha-one", "/login", "/nope-nope"]) {
  const r = await fetch(baseUrl + route);
  check(
    `${route} carries the policy too`,
    (r.headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
  );
}

// =======================================================================================
section("2. The policy does not break the site");
const viewers = {
  visitor: await open(null),
  buyer: await open(people.buyer),
  owner: await open(people.owner),
  admin: await open(people.admin),
};
const tours = {
  visitor: [
    "/",
    "/projects",
    "/project/alpha-one",
    "/builder/alpha",
    "/pricing",
    "/for-builders",
    "/login",
    "/privacy",
    "/terms",
  ],
  buyer: ["/account", "/account/enquiries", "/account/shortlist", "/account/privacy"],
  owner: [
    "/portal",
    "/portal/projects",
    "/portal/leads",
    "/portal/analytics",
    "/portal/reviews",
    "/portal/billing",
    "/portal/team",
    "/portal/promote",
    `/portal/projects/${projectId}/layout-map`,
    `/portal/projects/${projectId}/progress`,
  ],
  admin: ["/admin", "/admin/builders", "/admin/projects", "/admin/reviews", "/admin/billing"],
};
for (const [who, routes] of Object.entries(tours)) {
  const v = viewers[who];
  for (const route of routes) {
    await go(v.page, route);
    const inPage = await v.page.evaluate(() => window.__csp ?? []);
    check(
      `${who}: ${route} loads without a policy violation`,
      inPage.length === 0 && v.violations.length === 0,
      JSON.stringify([...inPage, ...v.violations]),
    );
    v.violations.length = 0;
  }
}
// the public project page really renders the features that need the policy's allowances
await go(viewers.visitor.page, "/project/alpha-one");
check(
  "the video player frame is allowed",
  (await viewers.visitor.page.locator('iframe[src*="youtube-nocookie.com"]').count()) === 1,
);
check(
  "the layout map and progress updates render",
  (await viewers.visitor.page.getByTestId("layout-map").count()) === 1 &&
    (await viewers.visitor.page.getByTestId("progress-update").count()) === 1,
);
check(
  "the tour link opens safely in a new tab",
  (await viewers.visitor.page.locator('a[href*="matterport"]').getAttribute("rel"))?.includes(
    "noopener",
  ),
);
check(
  "a page cannot be framed by another site",
  await (async () => {
    const framer = await browser.newPage();
    await framer.setContent(`<iframe id="f" src="${baseUrl}/"></iframe>`);
    await framer.waitForTimeout(1500);
    const frame = framer.frames().find((f) => f.url().startsWith(baseUrl));
    const loaded = frame ? (await frame.content().catch(() => "")).includes("RKB") : false;
    await framer.close();
    return !loaded;
  })(),
);

// =======================================================================================
section("3. Not found and errors");
const missing = await fetch(baseUrl + "/definitely/not/here");
check("an unknown address answers 404", missing.status === 404);
await go(viewers.visitor.page, "/definitely/not/here");
check(
  "with a branded page, a way back, and no detail",
  (await text(viewers.visitor.page)).includes("We could not find that page") &&
    (await viewers.visitor.page.getByRole("link", { name: "Browse projects" }).count()) >= 1,
);
const pj = await fetch(baseUrl + "/project/no-such-project");
check("a project that does not exist is a 404, not an error page", pj.status === 404);
check(
  "a private id is not found rather than refused",
  (await viewers.buyer.page.goto(baseUrl + "/account/bookings/nope"))?.status() === 404,
);

// =======================================================================================
section("4. A copy of your data, and erasure");
const buyerId = (await sql(`SELECT id FROM "User" WHERE email = $1`, [people.buyer.email]))[0].id;
await sql(`INSERT INTO "Shortlist"("userId","projectId") VALUES($1,$2)`, [buyerId, projectId]);
await sql(
  `INSERT INTO "Lead"(id,"projectId","builderId","buyerId",name,mobile,email,message,"consentAt","consentTermsVersion","updatedAt") VALUES($1,$2,$3,$4,'Asha Kumar','9876543210',$5,'Is plot A-1 east facing?',now(),'v1',now())`,
  [id(), projectId, builderId, buyerId, people.buyer.email],
);
await go(viewers.buyer.page, "/account/privacy");
check(
  "the privacy page offers both",
  (await viewers.buyer.page.getByTestId("download-data").count()) === 1 &&
    (await viewers.buyer.page.getByTestId("delete-account").count()) === 1,
);
const mine = await viewers.buyer.context.request.get(baseUrl + "/api/me/export");
const mineJson = await mine.json();
check(
  "the buyer downloads their own data as a file",
  mine.status() === 200 &&
    (mine.headers()["content-disposition"] ?? "").includes("attachment") &&
    mineJson.account.email === people.buyer.email &&
    mineJson.savedProjects.length === 1 &&
    mineJson.enquiries.length === 1,
);
check("it is never cached", (mine.headers()["cache-control"] ?? "").includes("no-store"));
const theirs = await viewers.owner.context.request.get(baseUrl + "/api/me/export");
check(
  "someone else gets only their own, never the buyer's",
  !(await theirs.text()).includes("Asha Kumar"),
);
check(
  "a visitor who is not logged in is refused",
  (await fetch(baseUrl + "/api/me/export", { redirect: "manual" })).status === 401,
);

await viewers.buyer.page.locator("#confirm-delete").fill("delete");
await viewers.buyer.page.getByRole("button", { name: "Delete my account" }).click();
await settle(viewers.buyer.page);
check(
  "deleting needs the exact word",
  (await viewers.buyer.page.getByTestId("delete-error").innerText()).includes("Type DELETE"),
);
check(
  "and nothing was erased",
  (await sql(`SELECT email FROM "User" WHERE id = $1`, [buyerId]))[0].email === people.buyer.email,
);

await viewers.buyer.page.locator("#confirm-delete").fill("DELETE");
await Promise.all([
  viewers.buyer.page.waitForResponse((r) => r.request().method() === "POST").catch(() => {}),
  viewers.buyer.page.getByRole("button", { name: "Delete my account" }).click(),
]);
await viewers.buyer.page.waitForTimeout(1500);
const gone = (
  await sql(`SELECT email, name, mobile, "auth0Sub" FROM "User" WHERE id = $1`, [buyerId])
)[0];
check(
  "the account is anonymised and cannot be signed into",
  gone.email === `deleted-${buyerId}@deleted.invalid` &&
    gone.name === null &&
    gone.mobile === null &&
    gone.auth0Sub === `deleted|${buyerId}`,
  JSON.stringify(gone),
);
const keptLead = (
  await sql(`SELECT name, mobile, email, message FROM "Lead" WHERE "buyerId" = $1`, [buyerId])
)[0];
check(
  "the builder's lead remains, without the person",
  keptLead.name === "Deleted user" &&
    keptLead.email === "deleted@deleted.invalid" &&
    keptLead.message === null,
  JSON.stringify(keptLead),
);
check(
  "saved projects are gone",
  Number(
    (await sql(`SELECT count(*) AS n FROM "Shortlist" WHERE "userId" = $1`, [buyerId]))[0].n,
  ) === 0,
);
check(
  "and the deletion is in the audit log",
  Number(
    (await sql(`SELECT count(*) AS n FROM "AuditLog" WHERE action = 'account.deleted'`))[0].n,
  ) === 1,
);

await go(viewers.owner.page, "/portal");
check(
  "a company owner is not offered buyer erasure",
  (await viewers.owner.page.goto(baseUrl + "/account/privacy")) !== null &&
    here(viewers.owner.page) !== "/account/privacy",
);

// =======================================================================================
section("5. Attacks that must fail");
const attacker = await open(people.other);
await go(attacker.page, "/account");
const post = (url, body, headers = {}) =>
  attacker.context.request.post(baseUrl + url, { data: body, headers });
check(
  "saving a project for someone else is impossible: the shortlist API has no user field",
  (await post("/api/shortlist", { projectId, saved: true, userId: buyerId })).status() === 200 &&
    Number(
      (await sql(`SELECT count(*) AS n FROM "Shortlist" WHERE "userId" = $1`, [buyerId]))[0].n,
    ) === 0,
);
check(
  "a buyer cannot reach a company's portal or the admin console",
  (await go(attacker.page, "/portal"), here(attacker.page) !== "/portal") &&
    (await go(attacker.page, "/admin"), here(attacker.page) !== "/admin"),
);
const noBody = await attacker.context.request.post(baseUrl + "/api/shortlist", {
  data: "x",
  headers: { "content-type": "text/plain" },
});
check("an API that expects JSON refuses anything else", noBody.status() === 415);
check(
  "a company's file route does not serve private documents",
  (await fetch(baseUrl + `/api/files/builders/${builderId}/docs/pan-abc.pdf`)).status !== 200,
);
for (const trick of [
  `/api/files/builders/${builderId}/public/%2e%2e/docs/x.pdf`,
  "/api/files/..%2F..%2Fetc%2Fpasswd",
  `/api/files/builders/${builderId}/public/..%5Cdocs%5Cx.pdf`,
]) {
  const r = await fetch(baseUrl + trick);
  check(
    `a path trick does not climb out: ${trick.slice(0, 50)}`,
    r.status === 404 || r.status === 400,
    `status ${r.status}`,
  );
}
const login = await fetch(baseUrl + "/auth/login?returnTo=https://evil.example/", {
  redirect: "manual",
});
check(
  "login does not send people to another site afterwards",
  !(login.headers.get("location") ?? "").includes("evil.example"),
  login.headers.get("location") ?? "",
);
const sw = await attacker.context.request.get(baseUrl + "/switch?to=buyer&next=//evil.example", {
  maxRedirects: 0,
});
check(
  "the account switch refuses an off-site next address",
  !(sw.headers()["location"] ?? "").includes("evil.example"),
  sw.headers()["location"] ?? String(sw.status()),
);
const sw2 = await attacker.context.request.get(
  baseUrl + "/switch?to=buyer&next=https://evil.example/x",
  { maxRedirects: 0 },
);
check(
  "and a full address",
  !(sw2.headers()["location"] ?? "").includes("evil.example"),
  sw2.headers()["location"] ?? String(sw2.status()),
);

for (const v of Object.values(viewers)) await v.context.close();
await attacker.context.close();
await browser.close();
await db.end();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
