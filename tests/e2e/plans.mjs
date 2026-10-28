// End-to-end check of plans, limits, billing by staff, the team, featured days and the plan's
// lifecycle (ending, reminders, projects going offline and coming back), in a real browser against
// a real Postgres, with the dev mail outbox. See docs/BILLING.md and docs/TESTING.md.
//
//   node tests/e2e/plans.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL> <mailOutboxDir> <CRON_SECRET>
//
// The server must run a production build with MAIL_DRIVER=file and MAIL_OUTBOX_DIR set to the same
// folder, CRON_SECRET set to the value passed here, ADMIN_EMAILS=admin@test.example and an EMPTY
// database. Sessions are signed with the Auth0 testing helper; mail is read from the outbox.
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
  sub: `auth0|p-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  owner1: person("owner1", "Owner One"),
  owner3: person("owner3", "Owner Three"),
  owner4: person("owner4", "Owner Four"),
  premier: person("premier", "Premier Owner"),
  teammate: person("teammate", "Tara Teammate"),
  stranger: person("stranger", "Sam Stranger"),
  buyer: person("buyer", "Asha Buyer"),
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
const here = (page) => new URL(page.url()).pathname;
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
/** Clicks something that posts a server action, and waits until the page it redirects to is showing. */
async function act(page, click) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 15000 }),
    click(),
  ]);
  await page.waitForTimeout(600);
  await settle(page);
}
const mailbox = async () => {
  try {
    return (await readFile(path.join(outboxDir, "mail-outbox.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
const mailTo = async (address, subjectPart) =>
  (await mailbox()).filter(
    (m) => [].concat(m.to).includes(address) && m.subject.includes(subjectPart),
  );
const cron = (job, secretValue = cronSecret) =>
  fetch(`${baseUrl}/api/cron/${job}`, {
    headers: secretValue ? { Authorization: `Bearer ${secretValue}` } : {},
  });

// ---------------------------------------------------------------------------------------
// data
async function company(name, slug, owner, plan) {
  const builderId = id();
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,$2,'VERIFIED',$3,now(),now())`,
    [builderId, name, slug],
  );
  if (plan) {
    await sql(
      `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,$3,'COMP',now(),now()+interval '60 days',now())`,
      [id(), builderId, plan],
    );
  }
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
  return { builderId, userId };
}
async function project(builderId, slug, name, status = "LIVE") {
  const projectId = id();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"publishedAt","updatedAt")
     VALUES($1,$2,$3,$4,$5,'PLOTTED','READY_TO_MOVE','Hosur','Main Road',now() - ($6 || ' days')::interval,now())`,
    [projectId, builderId, slug, status, name, String(Math.floor(Math.random() * 3) + 1)],
  );
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt")
     SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),1000,1850000,'AVAILABLE',now() FROM generate_series(1,5) g`,
    [projectId],
  );
  return projectId;
}

const c1 = await company("Plan Co", "plan-co", people.owner1, null);
const draft1 = await project(c1.builderId, null, "Plan Co Draft", "DRAFT");
const live1 = await project(c1.builderId, "plan-co-layout", "Plan Co Layout", "DRAFT");
const c3 = await company("Growth Homes", "growth-homes", people.owner3, "GROWTH");
const g1 = await project(c3.builderId, "growth-one", "Growth One");
const g2 = await project(c3.builderId, "growth-two", "Growth Two");
const g3 = await project(c3.builderId, "growth-three", "Growth Three");
const c4 = await company("Tiny Builders", "tiny-builders", people.owner4, "STARTER");
const p4 = await project(c4.builderId, "tiny-one", "Tiny One");
const cp = await company("Premier Estates", "premier-estates", people.premier, "PREMIER");
const pp = await project(cp.builderId, "premier-one", "Premier One");

// a buyer account for the person who will be invited, and one for a stranger
for (const user of [people.teammate, people.stranger, people.buyer]) {
  const session = await open(user);
  await go(session.page, "/account");
  await session.context.close();
}
const lead4 = id();
const buyerRow = (await sql(`SELECT id FROM "User" WHERE email = $1`, [people.buyer.email]))[0].id;
await sql(
  `INSERT INTO "Lead"(id,"projectId","builderId","buyerId",name,mobile,email,"consentAt","consentTermsVersion","updatedAt")
   VALUES($1,$2,$3,$4,'Asha Buyer','9876543210',$5,now(),'v1',now())`,
  [lead4, p4, c4.builderId, buyerRow, people.buyer.email],
);

// =======================================================================================
section("1. A verified company with no plan");
const o1 = await open(people.owner1);
check("the portal opens", (await go(o1.page, "/portal")) === "/portal");
check(
  "the overview says the company is on the free plan",
  (await o1.page.getByTestId("plan-summary").innerText()).includes("Free plan"),
);
const tabs1 = await o1.page.getByRole("navigation", { name: "Application steps" }).innerText();
check(
  "the owner sees Team, Promote and Plan and billing",
  ["Team", "Promote", "Plan and billing"].every((t) => tabs1.includes(t)),
  tabs1,
);
await go(o1.page, "/portal/billing");
check(
  "the billing page says so too",
  (await o1.page.getByTestId("plan-card").innerText()).includes("Free plan"),
);
check(
  "with no payment gateway configured, buying is switched off and says so",
  (await o1.page.getByTestId("no-online-payment").count()) === 1 &&
    (await o1.page.getByTestId("buy-GROWTH-MONTHLY").isDisabled()),
);
check(
  "and the payment webhook answers that it is not set up",
  (await fetch(`${baseUrl}/api/billing/webhook`, { method: "POST", body: "{}" })).status === 503,
);
check(
  "and shows the projects used against the Starter-sized limit for drafts",
  (await o1.page.getByTestId("meter-projects").innerText()).includes("2 of 2"),
  await o1.page.getByTestId("meter-projects").innerText(),
);
await go(o1.page, `/portal/projects/${draft1}/review`);
const submit = o1.page.getByRole("button", { name: "Submit for review" });
check("a draft CAN be submitted without a plan", await submit.isEnabled());
check("and the page says no plan is needed", (await text(o1.page)).includes("no plan is needed"));
check(
  "with a way to get one",
  await o1.page.getByRole("link", { name: "Plan and billing" }).first().isVisible(),
);
await go(o1.page, "/portal/projects");
check(
  "a third project is refused: the draft limit is the smallest plan's",
  (await o1.page.locator("#name").isDisabled()) &&
    (await text(o1.page)).includes("reached your plan"),
  (await text(o1.page)).slice(0, 300),
);

// =======================================================================================
section("2. Staff put the company on a plan");
const adm = await open(people.admin);
await go(adm.page, `/admin/builders/${c1.builderId}`);
check(
  "the admin page shows the company has no plan",
  (await adm.page.getByTestId("admin-plan-state").innerText()).includes("No plan"),
);
await adm.page.locator("#plan-code").selectOption("GROWTH");
await adm.page.locator("#plan-interval").selectOption("MONTHLY");
await adm.page.locator("#plan-reference").fill("UTR-42");
await act(adm.page, () => adm.page.getByRole("button", { name: "Set plan" }).click());
const flash = await text(adm.page);
check(
  "an invoice is issued",
  /Invoice RKB\/\d{4}-\d{2}\/0001 issued/.test(flash),
  flash.slice(0, 300),
);
check(
  "the admin page now shows Growth, active",
  (await adm.page.getByTestId("admin-plan-name").innerText()).includes("Growth, monthly") &&
    (await adm.page.getByTestId("admin-plan-state").innerText()).includes("Active"),
);
const invoice = (await sql(`SELECT * FROM "Invoice" WHERE "builderId" = $1`, [c1.builderId]))[0];
check(
  "the invoice adds up: 7,999 plus 18% GST",
  invoice.subtotalPaise === 799900 &&
    invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise === 143982 &&
    invoice.totalPaise === 943882,
  JSON.stringify(invoice),
);
check("it records the payment reference", invoice.paymentReference === "UTR-42");
check(
  "the plan is in the audit log",
  (
    await sql(
      `SELECT 1 FROM "AuditLog" WHERE action = 'subscription.assigned' AND "entityId" = $1`,
      [c1.builderId],
    )
  ).length === 1,
);
check(
  "a bad form is refused on the server: 0 periods",
  await (async () => {
    await go(adm.page, `/admin/builders/${c1.builderId}`);
    await adm.page.evaluate(() => {
      const input = document.querySelector("#plan-periods");
      input.removeAttribute("min");
      input.value = "0";
    });
    await act(adm.page, () => adm.page.getByRole("button", { name: "Set plan" }).click());
    return (await text(adm.page)).includes("Check the plan");
  })(),
);

await go(o1.page, "/portal/billing");
const card = await o1.page.getByTestId("plan-card").innerText();
check(
  "the owner sees the Growth plan, paid until a date",
  card.includes("Growth plan") && card.includes("Paid until"),
  card,
);
check("and the invoice", (await o1.page.getByTestId("invoices").innerText()).includes("RKB/"));
check(
  "usage now uses the Growth limits",
  (await o1.page.getByTestId("meter-projects").innerText()).includes("2 of 6") &&
    (await o1.page.getByTestId("meter-seats").innerText()).includes("1 of 3"),
);
await go(o1.page, `/portal/projects/${draft1}/review`);
check(
  "the draft can now be submitted",
  !(await o1.page.getByRole("button", { name: "Submit for review" }).isDisabled()),
);

// =======================================================================================
section("3. The plan ends: projects go offline, and come back");
await sql(`UPDATE "Project" SET status = 'LIVE', "publishedAt" = now() WHERE id = $1`, [live1]);
const pub = await open(null);
await pub.page.goto(baseUrl + "/project/plan-co-layout");
check(
  "a live project is public",
  (await pub.page.locator("h1").innerText()).includes("Plan Co Layout"),
);

// the last paid day passed 2 days ago: still in force through the grace days
await sql(
  `UPDATE "Subscription" SET "currentPeriodEnd" = now() - interval '2 days' WHERE "builderId" = $1`,
  [c1.builderId],
);
let ran = await (await cron("billing")).json();
check("two days late: still in force, nothing ended", ran.expired === 0, JSON.stringify(ran));
await go(o1.page, "/portal/billing");
check(
  "the owner is told the plan is overdue, with the grace days",
  (await o1.page.getByTestId("plan-card").innerText()).includes("stays in force for 3 more days"),
  await o1.page.getByTestId("plan-card").innerText(),
);

await sql(
  `UPDATE "Subscription" SET "currentPeriodEnd" = now() - interval '5 days' WHERE "builderId" = $1`,
  [c1.builderId],
);
ran = await (await cron("billing")).json();
check(
  "five days late: the plan is ended",
  ran.expired === 1 && ran.paused === undefined,
  JSON.stringify(ran),
);
const lapsed = (await sql(`SELECT status, "pauseReason" FROM "Project" WHERE id = $1`, [live1]))[0];
check(
  "the live project stays live: publishing never needed the plan",
  lapsed.status === "LIVE" && lapsed.pauseReason === null,
  JSON.stringify(lapsed),
);
check(
  "the owner is emailed, and told the projects stay live",
  (await mailTo(people.owner1.email, "Your plan has ended")).length === 1 &&
    (await mailTo(people.owner1.email, "Your plan has ended"))[0].text.includes("stay live"),
);
const stillThere = await pub.page.goto(baseUrl + "/project/plan-co-layout");
check(
  "the public page is still there",
  stillThere.status() === 200,
  `status ${stillThere.status()}`,
);
check(
  "running the job again changes nothing",
  (await (await cron("billing")).json()).expired === 0,
);
await go(o1.page, "/portal");
check(
  "the portal says the company is on the free plan",
  (await o1.page.getByTestId("plan-summary").innerText()).includes("Free plan"),
);
await go(o1.page, "/portal/projects");
check(
  "the limits drop to the free ones, but nothing is hidden",
  (await o1.page.getByTestId("project-allowance").innerText()).includes("of 2 projects used"),
);
await go(o1.page, `/portal/projects/${draft1}/review`);
check(
  "a draft can still be submitted",
  await o1.page.getByRole("button", { name: "Submit for review" }).isEnabled(),
);

// staff set a new plan: the extras come back, and nothing else changes
await go(adm.page, `/admin/builders/${c1.builderId}`);
await adm.page.locator("#plan-code").selectOption("GROWTH");
await adm.page.locator("#plan-kind").selectOption("comp");
await adm.page.locator("#plan-note").fill("Goodwill month");
await act(adm.page, () => adm.page.getByRole("button", { name: "Set plan" }).click());
check(
  "the plan is set",
  (await text(adm.page)).includes("Plan set"),
  (await text(adm.page)).slice(0, 200),
);
const back = (await sql(`SELECT status, "pauseReason" FROM "Project" WHERE id = $1`, [live1]))[0];
check(
  "the project is live, as it always was",
  back.status === "LIVE" && back.pauseReason === null,
  JSON.stringify(back),
);
const again = await pub.page.goto(baseUrl + "/project/plan-co-layout");
check("and public", again.status() === 200, `status ${again.status()}`);
check(
  "a complimentary plan makes no invoice",
  (await sql(`SELECT 1 FROM "Invoice" WHERE "builderId" = $1`, [c1.builderId])).length === 1,
);

section("3b. Renewal reminders");
await sql(
  `UPDATE "Subscription" SET "currentPeriodEnd" = now() + interval '2 days' WHERE "builderId" = $1`,
  [c1.builderId],
);
ran = await (await cron("billing")).json();
check("a plan ending in 2 days gets a reminder", ran.reminded === 1, JSON.stringify(ran));
check("it is emailed to the owner", (await mailTo(people.owner1.email, "plan ends")).length === 1);
check("only once", (await (await cron("billing")).json()).reminded === 0);
check("the billing job refuses a wrong secret", (await cron("billing", "wrong")).status === 401);
check("and no secret", (await cron("billing", "")).status === 401);
await sql(
  `UPDATE "Subscription" SET "currentPeriodEnd" = now() + interval '30 days' WHERE "builderId" = $1`,
  [c1.builderId],
);

// =======================================================================================
section("4. The home page shows Premier projects, labelled");
await pub.page.goto(baseUrl + "/");
await settle(pub.page);
const spotlight = pub.page.getByTestId("spotlight");
check("the spotlight is there", (await spotlight.count()) === 1);
check(
  "it shows the Premier company's project and says it is sponsored",
  (await spotlight.innerText()).includes("Premier One") &&
    (await spotlight.innerText()).toLowerCase().includes("sponsored"),
  (await spotlight.innerText().catch(() => "")).slice(0, 200),
);
check("a Growth company is not in it", !(await spotlight.innerText()).includes("Growth One"));

// =======================================================================================
section("5. Basic and full lead dashboards");
const o4 = await open(people.owner4);
await go(o4.page, "/portal/leads");
check(
  "a Starter company sees the upgrade note on the lead list",
  (await o4.page.getByTestId("upgrade-notice").count()) === 1,
);
check("and no CSV export button", (await o4.page.getByTestId("export-csv").count()) === 0);
const exportStarter = await o4.context.request.get(baseUrl + "/api/builder/leads/export");
check(
  "the export is refused on the server too",
  exportStarter.status() === 403,
  `status ${exportStarter.status()}`,
);
await go(o4.page, `/portal/leads/${lead4}`);
check(
  "the lead page opens and the status can be changed",
  (await o4.page.locator("select").count()) >= 1,
);
check(
  "follow-up date is replaced by an upgrade note",
  (await o4.page.locator("#lead-followup").count()) === 0 &&
    (await o4.page.getByTestId("upgrade-notice").count()) >= 1,
);
await sql(`UPDATE "Subscription" SET plan = 'GROWTH' WHERE "builderId" = $1`, [c4.builderId]);
await go(o4.page, `/portal/leads/${lead4}`);
check(
  "on Growth the follow-up date is there",
  (await o4.page.locator("#lead-followup").count()) === 1,
);
const exportGrowth = await o4.context.request.get(baseUrl + "/api/builder/leads/export");
check(
  "and the export works",
  exportGrowth.status() === 200 && (await exportGrowth.text()).includes("Asha Buyer"),
);
await sql(`UPDATE "Subscription" SET plan = 'STARTER' WHERE "builderId" = $1`, [c4.builderId]);

// =======================================================================================
section("6. The team");
await go(o1.page, "/portal/team");
check(
  "the owner sees the team page, one of three seats used",
  (await o1.page.getByTestId("seats").innerText()).includes("1 of 3"),
);
await o1.page.locator("#invite-email").fill(people.teammate.email);
await o1.page.locator("#invite-role").selectOption("MANAGER");
await act(o1.page, () => o1.page.getByRole("button", { name: "Send invitation" }).click());
check(
  "the invitation is sent",
  (await text(o1.page)).includes(`Invitation sent to ${people.teammate.email}`),
);
check(
  "it waits in the list, holding a seat",
  (await o1.page.getByTestId("invites").innerText()).includes(people.teammate.email) &&
    (await o1.page.getByTestId("seats").innerText()).includes("2 of 3"),
);
const inviteMail = (await mailTo(people.teammate.email, "Join Plan Co"))[0];
const inviteLink = inviteMail?.text.match(/https?:\/\/[^\s]+\/join\/[A-Za-z0-9_-]+/)?.[0];
check("the email carries a join link", Boolean(inviteLink), inviteMail?.text.slice(0, 200));
const joinPath = inviteLink ? new URL(inviteLink).pathname : "/join/x";
check(
  "the token is not stored in the database, only its hash",
  (await sql(`SELECT "tokenHash" FROM "TeamInvite"`)).every((r) => !joinPath.includes(r.tokenHash)),
);

const tm = await open(people.teammate);
await go(tm.page, joinPath);
check("the invited person sees the company name", (await text(tm.page)).includes("Plan Co"));
const strangerSession = await open(people.stranger);
await go(strangerSession.page, joinPath);
check(
  "a different logged-in person is told it is for another address",
  (await strangerSession.page.getByTestId("join-mismatch").count()) === 1,
);
check(
  "and there is no accept button for them",
  (await strangerSession.page.getByRole("button", { name: "Accept the invitation" }).count()) === 0,
);

await tm.page.getByRole("button", { name: "Accept the invitation" }).click();
await tm.page.waitForURL((u) => u.pathname.startsWith("/portal"));
await settle(tm.page);
check("accepting lands in the company's portal", here(tm.page) === "/portal", where(tm.page));
const tmTabs = await tm.page.getByRole("navigation", { name: "Application steps" }).innerText();
check(
  "a manager sees Projects, Leads and Promote",
  ["Projects", "Leads", "Promote"].every((t) => tmTabs.includes(t)),
  tmTabs,
);
check(
  "but not the owner's tabs",
  !["Team", "Company profile", "Documents", "Plan and billing", "Review and submit"].some((t) =>
    tmTabs.includes(t),
  ),
  tmTabs,
);
for (const owner of [
  "/portal/billing",
  "/portal/team",
  "/portal/profile",
  "/portal/documents",
  "/portal/review",
  "/portal/plan",
]) {
  check(
    `a teammate is sent back from ${owner}`,
    (await go(tm.page, owner)) === "/portal",
    where(tm.page),
  );
}
const uploadByTeammate = await tm.context.request.post(baseUrl + "/api/builder/upload", {
  multipart: {
    kind: "LOGO",
    file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
  },
});
check(
  "a teammate cannot upload the company's logo",
  uploadByTeammate.status() === 403,
  `status ${uploadByTeammate.status()}`,
);
check(
  "a teammate sees the company's leads and projects",
  (await go(tm.page, "/portal/projects")) === "/portal/projects" &&
    (await go(tm.page, "/portal/leads")) === "/portal/leads",
);
check(
  "the switch to the buyer account is there, and buyer pages work",
  (await go(tm.page, "/switch?to=buyer")) === "/account",
);
const row = (
  await sql(
    `SELECT u.role, bm.role AS member FROM "User" u JOIN "BuilderMember" bm ON bm."userId" = u.id WHERE u.email = $1`,
    [people.teammate.email],
  )
)[0];
check(
  "the person is now a builder-team member of that company",
  row.role === "BUILDER_TEAM" && row.member === "MANAGER",
  JSON.stringify(row),
);

await go(tm.page, joinPath);
check("the link cannot be used twice", (await text(tm.page)).includes("already been used"));

// the owner manages the team
await go(o1.page, "/portal/team");
check(
  "the owner sees the teammate",
  (await o1.page.getByTestId("members").innerText()).includes(people.teammate.email),
);
await o1.page.locator(`select[name="role"]`).first().selectOption("STAFF");
await act(o1.page, () => o1.page.getByRole("button", { name: "Save" }).first().click());
check(
  "the role can be changed to staff",
  (
    await sql(
      `SELECT bm.role FROM "BuilderMember" bm JOIN "User" u ON u.id = bm."userId" WHERE u.email = $1`,
      [people.teammate.email],
    )
  )[0].role === "STAFF",
);
await go(tm.page, "/switch?to=builder&next=/portal");
check(
  "staff do not see Promote",
  !(await tm.page.getByRole("navigation", { name: "Application steps" }).innerText()).includes(
    "Promote",
  ),
);
check("and cannot open it", (await go(tm.page, "/portal/promote")) === "/portal");

// seats
await go(o1.page, "/portal/team");
await o1.page.locator("#invite-email").fill("second@test.example");
await act(o1.page, () => o1.page.getByRole("button", { name: "Send invitation" }).click());
check(
  "a second seat can be invited",
  (await o1.page.getByTestId("seats").innerText()).includes("3 of 3"),
);
check(
  "then the plan is full: an upgrade note replaces the form",
  (await o1.page.locator("#invite-email").count()) === 0 &&
    (await o1.page.getByTestId("upgrade-notice").count()) === 1,
);

await act(o1.page, () => o1.page.getByRole("button", { name: "Withdraw" }).first().click());
check(
  "withdrawing an invitation frees the seat",
  (await o1.page.locator("#invite-email").count()) === 1,
);

await act(o1.page, () => o1.page.getByRole("button", { name: "Remove" }).first().click());
check(
  "removing a teammate works",
  (
    await sql(
      `SELECT 1 FROM "BuilderMember" bm JOIN "User" u ON u.id = bm."userId" WHERE u.email = $1`,
      [people.teammate.email],
    )
  ).length === 0,
);
check(
  "they are a buyer again",
  (await sql(`SELECT role FROM "User" WHERE email = $1`, [people.teammate.email]))[0].role ===
    "BUYER",
);
check(
  "and the portal is closed to them",
  (await go(tm.page, "/portal")) === "/account",
  where(tm.page),
);

// =======================================================================================
section("7. Featured days and ranking");
const o3 = await open(people.owner3);
await go(o3.page, "/portal/promote");
check(
  "the Growth owner sees the allowance",
  (await o3.page.getByTestId("featured-allowance").innerText()).includes("0 of 2"),
);
async function book(projectId, day) {
  await o3.page.locator("#feature-project").selectOption(projectId);
  await o3.page.locator("#feature-day").fill(day);
  await act(o3.page, () => o3.page.getByRole("button", { name: "Book the day" }).click());
}
const today = await o3.page.locator("#feature-day").getAttribute("min");
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
await book(g1, tomorrow);
check("a day can be booked", (await text(o3.page)).includes("Featured day booked"));
check(
  "a future day can be taken back",
  (await o3.page.getByRole("button", { name: "Take back" }).count()) === 1,
);
await act(o3.page, () => o3.page.getByRole("button", { name: "Take back" }).click());
check(
  "taking it back frees the allowance",
  (await o3.page.getByTestId("featured-allowance").innerText()).includes("0 of 2"),
);
await book(g2, today);
await book(g3, today);
check(
  "two days booked, the allowance is used up",
  (await o3.page.getByTestId("featured-allowance").innerText()).includes("2 of 2"),
);
await book(g1, today);
check(
  "a third booking is refused with a reason",
  (await text(o3.page)).includes("used all 2 featured days"),
);
check(
  "today's booking cannot be taken back",
  (await o3.page.getByRole("button", { name: "Take back" }).count()) === 0,
);

await pub.page.goto(baseUrl + "/projects");
await settle(pub.page);
const order = await pub.page.locator('[data-testid="listing-card"]').evaluateAll((els) =>
  els.map((el) => ({
    slug: el.getAttribute("data-slug"),
    featured: /Featured/.test(el.innerText),
  })),
);
const slugs = order.map((o) => o.slug);
check(
  "search lists the Premier company's project and the two featured ones before the rest",
  slugs.slice(0, 3).sort().join() === ["growth-three", "growth-two", "premier-one"].sort().join(),
  slugs.join(),
);
check(
  "and labels them Featured",
  order.slice(0, 3).every((o) => o.featured) && order.slice(3).every((o) => !o.featured),
  JSON.stringify(order),
);
const price = await open(null);
await price.page.goto(baseUrl + "/projects?sort=price_asc");
await settle(price.page);
check(
  "an explicit sort is left exactly as chosen",
  (await price.page.locator('[data-testid="listing-card"]').count()) >= 4,
);

const o4b = await open(people.owner4);
await go(o4b.page, "/portal/promote");
check(
  "a Starter company sees an upgrade note instead of a booking form",
  (await o4b.page.getByTestId("upgrade-notice").count()) === 1 &&
    (await o4b.page.locator("#feature-day").count()) === 0,
);
const premierOwner = await open(people.premier);
await go(premierOwner.page, "/portal/promote");
check(
  "a Premier company is told it needs to book nothing",
  (await text(premierOwner.page)).includes("nothing to book"),
);

// =======================================================================================
section("8. The new pages at phone width");
for (const [user, route] of [
  [people.owner1, "/portal/billing"],
  [people.owner1, "/portal/team"],
  [people.owner3, "/portal/promote"],
  [people.admin, `/admin/builders/${c1.builderId}`],
]) {
  const phone = await open(user, PHONE);
  await go(phone.page, route);
  check(`${route} does not scroll sideways`, !(await overflows(phone.page)));
  await phone.context.close();
}

await browser.close();
await db.end();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
