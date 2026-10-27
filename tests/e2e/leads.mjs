// End-to-end check of enquiries, leads and the scheduled jobs, in a real browser, against a real
// Postgres, with the dev mail outbox. See docs/LEADS.md and docs/TESTING.md.
//
//   node tests/e2e/leads.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL> <mailOutboxDir> <CRON_SECRET>
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

const people = {
  buyer: {
    sub: "auth0|l-buyer",
    email: "asha.buyer@test.example",
    email_verified: true,
    name: "Asha Buyer",
  },
  buyer2: {
    sub: "auth0|l-buyer2",
    email: "ravi.buyer@test.example",
    email_verified: true,
    name: "Ravi Buyer",
  },
  ownerA: {
    sub: "auth0|l-ownerA",
    email: "owner-a@test.example",
    email_verified: true,
    name: "Owner A",
  },
  ownerB: {
    sub: "auth0|l-ownerB",
    email: "owner-b@test.example",
    email_verified: true,
    name: "Owner B",
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
async function acceptTermsIfAsked(page) {
  if (new URL(page.url()).pathname === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/welcome");
    await settle(page);
  }
}
async function go(page, route) {
  await page.goto(baseUrl + route);
  await acceptTermsIfAsked(page);
  await settle(page);
  return where(page);
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
// data: two companies, each with an owner and a live project
async function company(name, slug, owner) {
  const builderId = randomUUID().replace(/-/g, "");
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,"verifiedAt","updatedAt") VALUES($1,$2,'VERIFIED',$3,now(),now())`,
    [builderId, name, slug],
  );
  // a plan in force: the full lead dashboard (follow-ups, reminders) is part of it
  await sql(
    `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,'GROWTH','COMP',now(),now()+interval '60 days',now())`,
    [randomUUID().replace(/-/g, ""), builderId],
  );
  const userId = randomUUID().replace(/-/g, "");
  await sql(
    `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,$2,$3,$4,'BUILDER_OWNER',now())`,
    [userId, owner.sub, owner.email, owner.name],
  );
  await sql(`INSERT INTO "BuilderMember"(id,"builderId","userId",role) VALUES($1,$2,$3,'OWNER')`, [
    randomUUID().replace(/-/g, ""),
    builderId,
    userId,
  ]);
  return builderId;
}
async function project(builderId, slug, name) {
  const id = randomUUID().replace(/-/g, "");
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"publishedAt","updatedAt")
     VALUES($1,$2,$3,'LIVE',$4,'PLOTTED','READY_TO_MOVE','Hosur','Main Road',now(),now())`,
    [id, builderId, slug, name],
  );
  await sql(
    `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt")
     SELECT gen_random_uuid()::text,$1,'A-'||g,'a-'||lpad(g::text,8,'0'),1000,1850000,'AVAILABLE',now() FROM generate_series(1,10) g`,
    [id],
  );
  return id;
}
const builderA = await company("Anand Realty", "anand-realty", people.ownerA);
const builderB = await company("Lake Builders", "lake-builders", people.ownerB);
const projectA = await project(builderA, "green-valley", "Green Valley Enclave");
const projectB = await project(builderB, "lake-view", "Lake View Plots");

/** Waits for the "sent" panel; if it never comes, prints what the dialog shows instead, then fails. */
async function sentPanel(page) {
  try {
    await page.getByTestId("enquiry-sent").waitFor({ timeout: 10000 });
  } catch (error) {
    console.log(
      "DIALOG SHOWS:",
      (await page.getByTestId("enquiry-dialog").innerText()).replace(/\s+/g, " "),
    );
    throw error;
  }
}
const form = (page) => page.getByTestId("enquiry-dialog");
const enquireButton = (page) => page.getByTestId("enquire-button").first();
async function openEnquiry(page, slug = "green-valley") {
  await page.goto(`${baseUrl}/project/${slug}`);
  await settle(page);
  await enquireButton(page).click();
  await form(page).waitFor({ state: "visible" });
}

// =======================================================================================
section("1. A visitor who is not logged in");

const anon = await open(null);
await anon.page.goto(baseUrl + "/project/green-valley");
await settle(anon.page);
check(
  "the project page offers Send enquiry",
  (await enquireButton(anon.page).innerText()).includes("Send enquiry"),
);
check("the dialog is closed to begin with", !(await form(anon.page).isVisible()));
await enquireButton(anon.page).click();
await form(anon.page).waitFor({ state: "visible" });
check("pressing it opens the dialog", await anon.page.getByTestId("enquiry-login").isVisible());
const loginLink = await anon.page
  .getByRole("link", { name: "Log in as a buyer" })
  .getAttribute("href");
check(
  "a visitor is asked to log in as a buyer, and brought back to this project with the form open",
  loginLink.startsWith("/auth/login?returnTo=") &&
    decodeURIComponent(decodeURIComponent(loginLink)).includes("/project/green-valley?enquire=1"),
  loginLink,
);
check("there is no form for them yet", (await anon.page.locator("#enq-name").count()) === 0);
await anon.page.getByRole("button", { name: "Close" }).first().click();
check("closing takes #enquire off the address", !(await anon.page.evaluate(() => location.hash)));
await enquireButton(anon.page).click();
check("so the button works again", await form(anon.page).isVisible());
await anon.page.keyboard.press("Escape");
await anon.page.goto(baseUrl + "/project/green-valley?enquire=1");
await settle(anon.page);
check(
  "?enquire=1 (where a visitor lands after logging in) opens it by itself",
  await form(anon.page).isVisible(),
);
check("nothing was saved", (await sql(`SELECT count(*)::int AS n FROM "Lead"`))[0].n === 0);

// =======================================================================================
section("2. A buyer sends an enquiry");

const buyer = await open(people.buyer);
const bp = buyer.page;
await go(bp, "/dashboard?as=buyer");
await openEnquiry(bp);
check("a logged-in buyer sees the form", await bp.locator("#enq-name").isVisible());
check(
  "with a consent checkbox that is not ticked",
  !(await bp.locator('input[name="consent"]').isChecked()),
);
await bp.locator("#enq-name").fill("");
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await bp.getByText("Please check the highlighted fields.").waitFor();
const errs = await text(bp);
check(
  "sending nothing says what is missing",
  errs.includes("Please enter your name.") &&
    errs.includes("Enter a valid 10 digit Indian mobile number.") &&
    errs.includes("Please tick the box"),
);
check("and saves nothing", (await sql(`SELECT count(*)::int AS n FROM "Lead"`))[0].n === 0);

await bp.locator("#enq-name").fill("Asha Kumar");
await bp.locator("#enq-mobile").fill("12345");
await bp.locator('input[name="consent"]').check();
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await bp.getByText("Enter a valid 10 digit Indian mobile number.").waitFor();
check(
  "a bad mobile number is refused",
  (await sql(`SELECT count(*)::int AS n FROM "Lead"`))[0].n === 0,
);
check(
  "and a mistake does not wipe what the buyer already typed",
  (await bp.locator("#enq-name").inputValue()) === "Asha Kumar" &&
    (await bp.locator("#enq-mobile").inputValue()) === "12345" &&
    (await bp.locator('input[name="consent"]').isChecked()),
);

await bp.locator("#enq-mobile").fill("98765 43210");
await bp.locator("#enq-message").fill("Is plot A-3 still free? What is the registration cost?");
await bp.locator("#enq-plot").fill("A-3");
const visit = new Date(Date.now() + 2 * 86400000);
const pad = (n) => String(n).padStart(2, "0");
await bp
  .locator("#enq-visit")
  .fill(`${visit.getFullYear()}-${pad(visit.getMonth() + 1)}-${pad(visit.getDate())}T11:00`);
await bp.locator('input[name="consent"]').check();
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await sentPanel(bp);
check(
  "the buyer is told it was sent",
  (await bp.getByTestId("enquiry-sent").innerText()).includes("Your enquiry was sent"),
);

const [lead] = await sql(`SELECT * FROM "Lead"`);
check(
  "one lead was saved for the right company and project",
  lead && lead.builderId === builderA && lead.projectId === projectA,
  JSON.stringify(lead),
);
check(
  "with the buyer's details and the message",
  lead.name === "Asha Kumar" &&
    lead.mobile === "9876543210" &&
    lead.email === "asha.buyer@test.example" &&
    lead.message.includes("A-3") &&
    lead.preferredPlot === "A-3",
);
check("the mobile is marked as not verified", lead.mobileVerified === false);
check(
  "and the consent was recorded with the terms version",
  Boolean(lead.consentAt) && Boolean(lead.consentTermsVersion),
);
check(
  "the site visit was recorded as requested",
  (await sql(`SELECT status FROM "SiteVisit"`))[0]?.status === "REQUESTED",
);

await new Promise((r) => setTimeout(r, 400));
const builderMail = await mailTo("owner-a@test.example", "New enquiry for Green Valley Enclave");
check(
  "the builder was emailed straight away",
  builderMail.length === 1,
  String(builderMail.length),
);
check(
  "the email has the buyer's details and a one-tap WhatsApp reply",
  builderMail[0]?.text.includes("9876543210") &&
    builderMail[0]?.text.includes("https://wa.me/919876543210") &&
    builderMail[0]?.text.includes("not verified"),
);
check("and a link to the lead", builderMail[0]?.text.includes(`/portal/leads/${lead.id}`));
check(
  "the buyer got a confirmation",
  (await mailTo("asha.buyer@test.example", "was sent")).length === 1,
);

await bp.getByRole("button", { name: "Close" }).first().click();
check("the dialog closes", !(await form(bp).isVisible()));
await enquireButton(bp).click();
await form(bp).waitFor({ state: "visible" });
check(
  "opened again it is a fresh form, filled in with what the buyer gave last time",
  (await bp.locator("#enq-name").inputValue()) === "Asha Buyer" &&
    (await bp.locator("#enq-mobile").inputValue()) === "9876543210" &&
    (await bp.locator("#enq-message").inputValue()) === "",
);

await bp.locator("#enq-name").fill("Asha Kumar");
await bp.locator("#enq-message").fill("One more thing: is a bank loan available?");
await bp.locator('input[name="consent"]').check();
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await sentPanel(bp);
check(
  "a second message on the same project is added to the first",
  (await bp.getByTestId("enquiry-sent").innerText()).includes("Your message was added"),
);
check("not a duplicate lead", (await sql(`SELECT count(*)::int AS n FROM "Lead"`))[0].n === 1);
check(
  "the message is on the timeline",
  (await sql(`SELECT text FROM "LeadNote" WHERE kind='BUYER'`)).some((n) =>
    n.text.includes("bank loan"),
  ),
);
await new Promise((r) => setTimeout(r, 400));
check(
  "the builder is told again, as a new message",
  (await mailTo("owner-a@test.example", "New message for Green Valley Enclave")).length === 1,
);
check(
  "but the buyer's confirmation is not repeated",
  (await mailTo("asha.buyer@test.example", "was sent")).length === 1,
);

// a bot
await bp.getByRole("button", { name: "Close" }).first().click();
await enquireButton(bp).click();
await form(bp).waitFor({ state: "visible" });
await bp.locator("#enq-name").fill("Asha Kumar");
await bp.locator("#enq-message").fill("buy cheap watches");
await bp.locator('input[name="consent"]').check();
await bp.evaluate(() => {
  document.querySelector('input[name="website"]').value = "http://spam.example";
});
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await sentPanel(bp);
check(
  "a bot that fills in the hidden field is told it worked",
  (await bp.getByTestId("enquiry-sent").innerText()).includes("sent"),
);
check(
  "but nothing was saved",
  (await sql(`SELECT count(*)::int AS n FROM "LeadNote" WHERE text LIKE '%watches%'`))[0].n === 0,
);
await bp.getByRole("button", { name: "Close" }).first().click();

// the daily limit: one lead and one message so far
for (let i = 3; i <= 5; i++) {
  await enquireButton(bp).click();
  await form(bp).waitFor({ state: "visible" });
  await bp.locator("#enq-name").fill("Asha Kumar");
  await bp.locator("#enq-message").fill(`Message number ${i}`);
  await bp.locator('input[name="consent"]').check();
  await bp.getByRole("button", { name: "Send enquiry" }).last().click();
  await sentPanel(bp);
  await bp.getByRole("button", { name: "Close" }).first().click();
}
await enquireButton(bp).click();
await form(bp).waitFor({ state: "visible" });
await bp.locator("#enq-name").fill("Asha Kumar");
await bp.locator("#enq-message").fill("This one is too many");
await bp.locator('input[name="consent"]').check();
await bp.getByRole("button", { name: "Send enquiry" }).last().click();
await bp.getByText("You have sent several enquiries today.").waitFor();
check(
  "a buyer who sends too many in a day is asked to wait",
  (await text(bp)).includes("Please try again tomorrow."),
);
check(
  "and the extra message was not saved",
  (await sql(`SELECT count(*)::int AS n FROM "LeadNote" WHERE text LIKE '%too many%'`))[0].n === 0,
);
await bp.keyboard.press("Escape");

await go(bp, "/account/enquiries");
check(
  "the buyer sees the enquiry under My enquiries, as Sent",
  (await bp.getByTestId("my-enquiry").count()) === 1 &&
    (await bp.getByTestId("my-enquiry").innerText()).includes("Sent"),
);
check("with the requested site visit", (await text(bp)).includes("Site visit requested for"));
check(
  "and the builder's pipeline words are not shown to them",
  !(await text(bp)).includes("Negotiation") && !(await text(bp)).includes("Lost"),
);
check(
  "My enquiries is in the buyer's tabs",
  (await bp
    .getByRole("navigation", { name: "Your account" })
    .getByRole("link", { name: "My enquiries" })
    .count()) === 1,
);

// =======================================================================================
section("3. The builder works the lead");

const owner = await open(people.ownerA);
const op = owner.page;
await go(op, "/portal");
check(
  "the portal's Leads tab shows an unread count",
  (
    await op
      .getByRole("link", { name: /^Leads/ })
      .first()
      .innerText()
  ).includes("1"),
);
await go(op, "/portal/leads");
check(
  "the inbox lists the lead, marked unread",
  (await op.getByTestId("lead-row").count()) === 1 &&
    (await op.getByTestId("lead-row").innerText()).includes("Unread"),
);
check(
  "with project, plot and mobile",
  (await op.getByTestId("lead-row").innerText()).includes("Green Valley Enclave") &&
    (await op.getByTestId("lead-row").innerText()).includes("A-3") &&
    (await op.getByTestId("lead-row").innerText()).includes("9876543210"),
);
check(
  "and a hint that a site visit was asked for",
  (await op.getByTestId("lead-row").innerText()).includes("Site visit asked for"),
);
await op.getByTestId("lead-row").getByRole("link", { name: "Asha Kumar" }).click();
await op.waitForURL(/\/portal\/leads\/.+/);
await settle(op);
const leadPath = new URL(op.url()).pathname;
check(
  "opening it shows everything the buyer wrote",
  (await text(op)).includes("Is plot A-3 still free?") &&
    (await text(op)).includes("asha.buyer@test.example"),
);
check(
  "and says the mobile is not verified",
  (await op.getByTestId("lead-card").innerText()).includes("Not verified"),
);
check(
  "with a Call link and a WhatsApp link to the buyer",
  (await op.getByTestId("call-lead").getAttribute("href")) === "tel:+919876543210" &&
    (await op.getByTestId("whatsapp-lead").getAttribute("href")).startsWith(
      "https://wa.me/919876543210",
    ),
);
check("and the consent shown", (await text(op)).includes("agreed on"));
check(
  "both of the buyer's messages are on the timeline",
  (await op.getByTestId("timeline").innerText()).includes("bank loan"),
);
check(
  "opening the lead marks it as read",
  (await sql(`SELECT "seenAt" FROM "Lead"`))[0].seenAt !== null,
);

await op.locator("#lead-status").selectOption("CONTACTED");
await op.getByRole("button", { name: "Update" }).click();
await op.getByText("Status updated.").waitFor();
check(
  "the builder moves it to Contacted",
  (await sql(`SELECT status FROM "Lead"`))[0].status === "CONTACTED",
);
check(
  "and the change is on the timeline",
  (await op.getByTestId("timeline").innerText()).includes("Status changed from New to Contacted."),
);
await op.locator("#lead-note").fill("Called. Wants to visit on Sunday.");
await op.getByRole("button", { name: "Add note" }).click();
await op.getByText("Note added.").waitFor();
check(
  "a note can be added",
  (await op.getByTestId("timeline").innerText()).includes("Wants to visit on Sunday."),
);
check(
  "a note is private: it is not in anything the buyer can load",
  (await sql(`SELECT kind FROM "LeadNote" WHERE text LIKE 'Called.%'`))[0].kind === "BUILDER",
);

await op.getByTestId("visits").getByRole("button", { name: "Mark confirmed" }).click();
await op.getByText("Visit updated.").waitFor();
check(
  "a site visit can be confirmed",
  (await sql(`SELECT status FROM "SiteVisit"`))[0].status === "CONFIRMED",
);

// follow-up in the past, so the reminder is due now
const past = new Date(Date.now() - 2 * 3600000);
await op
  .locator("#lead-followup")
  .fill(
    `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`,
  );
await op.getByRole("button", { name: "Save date" }).click();
await op.getByText("Follow-up date saved.").waitFor();
check(
  "a follow-up date can be set",
  (await sql(`SELECT "followUpAt" FROM "Lead"`))[0].followUpAt !== null,
);

await go(op, "/portal/leads");
check(
  "the inbox now shows it as Contacted and no longer unread",
  (await op.getByTestId("lead-row").innerText()).includes("Contacted") &&
    !(await op.getByTestId("lead-row").innerText()).includes("Unread"),
);
await go(op, "/portal");
check(
  "the overview has the dashboard numbers for enquiries",
  (await op.getByTestId("builder-dashboard").innerText()).includes("Follow-ups due"),
);

// search and filters
await go(op, "/portal/leads?q=zzz");
check(
  "a search with no match says so",
  (await op.getByTestId("lead-count").innerText()).includes("No leads match"),
);
await go(op, "/portal/leads?q=asha");
check("search finds by name", (await op.getByTestId("lead-row").count()) === 1);
await go(op, "/portal/leads?q=98765");
check("and by part of the mobile number", (await op.getByTestId("lead-row").count()) === 1);
await go(op, "/portal/leads?status=BOOKED");
check(
  "the status filter hides leads in other stages",
  (await op.getByTestId("lead-row").count()) === 0,
);
await go(op, "/portal/leads?due=1");
check("the follow-up-due filter shows it", (await op.getByTestId("lead-row").count()) === 1);
await go(op, `/portal/leads?project=${projectB}`);
check(
  "a project of another company is ignored as a filter",
  (await op.getByTestId("lead-row").count()) === 1,
);

// CSV, and a lead with a spreadsheet formula for a name
const evilBuyer = await sql(
  `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,'auth0|evil','evil@test.example','Evil','BUYER',now()) RETURNING id`,
  [randomUUID().replace(/-/g, "")],
);
await sql(
  `INSERT INTO "Lead"(id,"projectId","builderId","buyerId",name,mobile,email,message,"consentAt","consentTermsVersion","lastBuyerMessageAt","updatedAt")
   VALUES($1,$2,$3,$4,$5,'9123456780','evil@test.example','=1+1',now(),'v',now(),now())`,
  [
    randomUUID().replace(/-/g, ""),
    projectA,
    builderA,
    evilBuyer[0].id,
    '=HYPERLINK("http://evil.example","click")',
  ],
);
const csv = await owner.context.request.get(baseUrl + "/api/builder/leads/export");
const csvText = await csv.text();
check(
  "the builder can export their leads as CSV",
  csv.status() === 200 &&
    (csv.headers()["content-type"] ?? "").includes("text/csv") &&
    /attachment/.test(csv.headers()["content-disposition"] ?? ""),
);
check(
  "it has the header and both leads",
  csvText.includes("Received,Name,Mobile") &&
    csvText.includes("Asha Kumar") &&
    csvText.includes("Green Valley Enclave"),
);
check(
  "a formula in a buyer's name or message is defused",
  csvText.includes("'=HYPERLINK") && csvText.includes("'=1+1") && !/(^|,)=HYPERLINK/.test(csvText),
);
const csvFiltered = await (
  await owner.context.request.get(baseUrl + "/api/builder/leads/export?q=asha")
).text();
check(
  "the export follows the filters",
  csvFiltered.includes("Asha Kumar") && !csvFiltered.includes("HYPERLINK"),
);

// =======================================================================================
section("4. The other company, and everyone else");

const other = await open(people.ownerB);
const xp = other.page;
await go(xp, "/portal"); // first visit: the terms page, then the portal
await go(xp, "/portal/leads");
await xp.getByRole("heading", { name: "Leads", exact: true }).waitFor();
check(
  "another company sees none of these leads",
  (await xp.getByTestId("lead-row").count()) === 0 && (await text(xp)).includes("No enquiries yet"),
);
const hidden = await xp.goto(baseUrl + leadPath);
check("and cannot open one by its address", hidden?.status() === 404, String(hidden?.status()));
const otherCsv = await (
  await other.context.request.get(baseUrl + "/api/builder/leads/export")
).text();
check("or export it", !otherCsv.includes("Asha Kumar"));
check(
  "a buyer cannot export leads",
  (await buyer.context.request.get(baseUrl + "/api/builder/leads/export")).status() === 403,
);
check("nor can a visitor", (await fetch(baseUrl + "/api/builder/leads/export")).status === 401);
const buyerPortal = await go(bp, "/portal/leads");
check(
  "a buyer opening the leads page is sent to their own area",
  buyerPortal === "/account",
  buyerPortal,
);

const buyer2 = await open(people.buyer2);
await go(buyer2.page, "/account/enquiries");
check(
  "another buyer sees no enquiries of Asha's",
  (await buyer2.page.getByTestId("my-enquiry").count()) === 0,
);

// the buyer sees progress
await go(bp, "/account/enquiries");
check(
  "the buyer sees the progress in friendly words",
  (await bp.getByTestId("my-enquiry").innerText()).includes("The builder is in touch"),
);
check("and the confirmed site visit", (await text(bp)).includes("Site visit confirmed for"));

// =======================================================================================
section("5. The scheduled jobs");

const noHeader = await cron("reminders", "");
check(
  "the scheduler URLs refuse a call with no secret",
  noHeader.status === 401,
  String(noHeader.status),
);
check(
  "and a wrong secret",
  (await cron("reminders", "not-the-secret-not-the-secret")).status === 401,
);
const run1 = await (await cron("reminders")).json();
check(
  "with the secret, the reminder job runs and finds the due follow-up",
  run1.job === "reminders" && run1.leads === 1 && run1.emails === 1,
  JSON.stringify(run1),
);
await new Promise((r) => setTimeout(r, 300));
const reminder = await mailTo("owner-a@test.example", "follow-up is due");
check(
  "the builder got a reminder naming the lead",
  reminder.length === 1 && reminder[0].text.includes("Asha Kumar"),
);
const run2 = await (await cron("reminders")).json();
check(
  "running it again sends nothing more",
  run2.leads === 0 &&
    run2.emails === 0 &&
    (await mailTo("owner-a@test.example", "follow-up is due")).length === 1,
  JSON.stringify(run2),
);
check(
  "the call works as a POST too",
  (
    await fetch(`${baseUrl}/api/cron/reminders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
  ).status === 200,
);

const dig1 = await (await cron("digest")).json();
check("the daily summary goes to the builder", dig1.emails >= 1, JSON.stringify(dig1));
await new Promise((r) => setTimeout(r, 300));
check(
  "saying how many enquiries arrived",
  (await mailTo("owner-a@test.example", "Your enquiries today")).length === 1,
);
check("and not twice in a day", (await (await cron("digest")).json()).emails === 0);

// an approval that expired yesterday
await sql(
  `INSERT INTO "ProjectApproval"(id,"projectId",kind,number,"validTill",verified,"updatedAt") VALUES($1,$2,'RERA','RERA/9',(now() - interval '2 days'),true,now())`,
  [randomUUID().replace(/-/g, ""), projectA],
);
const publicBefore = await fetch(baseUrl + "/project/green-valley");
check("before the job, the project is public", publicBefore.status === 200);
const exp = await (await cron("approvals")).json();
check(
  "the expiry job pauses the project with the expired approval",
  exp.paused === 1,
  JSON.stringify(exp),
);
check(
  "which disappears from the public site at once",
  (await fetch(baseUrl + "/project/green-valley")).status === 404,
);
check(
  "the other company's project is untouched",
  (await fetch(baseUrl + "/project/lake-view")).status === 200,
);
check("the builder was told why", (await mailTo("owner-a@test.example", "paused")).length === 1);
check(
  "it is marked paused in the database",
  (await sql(`SELECT status FROM "Project" WHERE id = $1`, [projectA]))[0].status === "PAUSED",
);
check(
  "the audit log records that the system did it",
  (
    await sql(
      `SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'project.paused_expired_approval'`,
    )
  )[0].n === 1,
);
check("a second run changes nothing", (await (await cron("approvals")).json()).paused === 0);

// =======================================================================================
section("6. On a phone");

const phone = await open(people.buyer2, PHONE);
const pp = phone.page;
await go(pp, "/dashboard?as=buyer");
await pp.goto(baseUrl + "/project/lake-view");
await settle(pp);
check(
  "the bar at the bottom offers Send enquiry",
  await pp.getByTestId("mobile-contact-bar").getByTestId("enquire-button").isVisible(),
);
await pp.getByTestId("mobile-contact-bar").getByTestId("enquire-button").click();
await form(pp).waitFor({ state: "visible" });
check(
  "the form opens and fits the screen",
  !(await overflows(pp)) && (await pp.locator("#enq-name").isVisible()),
);
const box = await form(pp).boundingBox();
check("the dialog is no wider than the phone", box.width <= PHONE.width);
await pp.locator("#enq-name").fill("Ravi Shankar");
await pp.locator("#enq-mobile").fill("9123456780");
await pp.locator('input[name="consent"]').check();
await pp.getByRole("button", { name: "Send enquiry" }).last().click();
await sentPanel(pp);
check(
  "a buyer can enquire from a phone",
  (await sql(`SELECT count(*)::int AS n FROM "Lead" WHERE "projectId" = $1`, [projectB]))[0].n ===
    1,
);
const leadsOnPhone = await open(people.ownerB, PHONE);
await go(leadsOnPhone.page, "/portal/leads");
check(
  "the builder's inbox fits a phone screen",
  !(await overflows(leadsOnPhone.page)) &&
    (await leadsOnPhone.page.getByTestId("lead-row").count()) === 1,
);
await go(leadsOnPhone.page, "/portal");
check("so does the dashboard", !(await overflows(leadsOnPhone.page)));
await go((await open(people.buyer, PHONE)).page, "/account/enquiries");

await browser.close();
await db.end();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
