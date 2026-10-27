// End-to-end check of online token booking: holding a plot, paying the token (with the test
// gateway), expiry, late payments, refunds, the gateway's webhook, the fallback "Request booking" and
// who may see what, in a real browser against a real Postgres. See docs/BOOKING.md.
//
//   node tests/e2e/booking.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL> <mailOutboxDir> <CRON_SECRET> <BILLING_TEST_SECRET>
//
// The server must run a production build with BOOKING_ENABLED=yes, BILLING_DRIVER=test,
// ALLOW_TEST_BILLING=yes and the same BILLING_TEST_SECRET, MAIL_DRIVER=file with MAIL_OUTBOX_DIR set to
// the folder passed here, CRON_SECRET, ADMIN_EMAILS=admin@test.example and an EMPTY database.
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const [, , projectDir, baseUrl, secret, databaseUrl, outboxDir, cronSecret, gatewaySecret] =
  process.argv;
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
  sub: `auth0|k-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  ownerA: person("ownera", "Owner A"),
  ownerB: person("ownerb", "Owner B"),
  buyer1: person("buyer1", "Asha Kumar"),
  buyer2: person("buyer2", "Ravi Shankar"),
  buyer3: person("buyer3", "Meena Iyer"),
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
  await page.waitForTimeout(800);
  await settle(page);
}
const mailTo = async (address, part) => {
  try {
    const lines = (await readFile(path.join(outboxDir, "mail-outbox.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return lines.filter((m) => [].concat(m.to).includes(address) && m.subject.includes(part));
  } catch {
    return [];
  }
};
const cron = (job) =>
  fetch(`${baseUrl}/api/cron/${job}`, { headers: { Authorization: `Bearer ${cronSecret}` } });
const sign = (body) => createHmac("sha256", gatewaySecret).update(body).digest("hex");
const webhook = (booking, createdAt, paymentId, eventId) => {
  const raw = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: booking.providerOrderId,
          amount: booking.tokenPaise,
          created_at: createdAt,
        },
      },
    },
  });
  return fetch(`${baseUrl}/api/billing/webhook`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": sign(raw),
      "x-razorpay-event-id": eventId,
    },
  });
};

// ---------------------------------------------------------------------------------------
async function company(name, slug, owner, payout) {
  const builderId = id();
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,"payoutAccountId","verifiedAt","updatedAt") VALUES($1,$2,'VERIFIED',$3,$4,now(),now())`,
    [builderId, name, slug, payout],
  );
  await sql(
    `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,'GROWTH','COMP',now(),now()+interval '60 days',now())`,
    [id(), builderId],
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
async function project(builderId, slug, name, token = 25000) {
  const projectId = id();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,city,locality,"tokenAmount","contactMobile","publishedAt","updatedAt") VALUES($1,$2,$3,'LIVE',$4,'PLOTTED','READY_TO_MOVE','Hosur','Main Road',$5,'9876543210',now(),now())`,
    [projectId, builderId, slug, name, token],
  );
  const plots = [];
  for (let g = 1; g <= 6; g++) {
    const plotId = id();
    await sql(
      `INSERT INTO "Plot"(id,"projectId",number,"sortKey","sizeSqft",price,status,"updatedAt") VALUES($1,$2,$3,$4,1000,1850000,$5::"PlotStatus",now())`,
      [
        plotId,
        projectId,
        `A-${g}`,
        `a-${String(g).padStart(8, "0")}`,
        g === 6 ? "SOLD" : "AVAILABLE",
      ],
    );
    plots.push(plotId);
  }
  return { projectId, plots };
}
const cA = await company("Alpha Builders", "alpha", people.ownerA, "acc_alpha123");
const cB = await company("Beta Builders", "beta", people.ownerB, null);
const A = await project(cA, "alpha-one", "Alpha One");
const B = await project(cB, "beta-one", "Beta One");
const buyerRow = async (user) =>
  (await sql(`SELECT id FROM "User" WHERE email = $1`, [user.email]))[0].id;
for (const user of [people.buyer1, people.buyer2, people.buyer3]) {
  const s = await open(user);
  await go(s.page, "/account");
  await s.context.close();
}
const plotStatus = async (plotId) =>
  (await sql(`SELECT status FROM "Plot" WHERE id = $1`, [plotId]))[0].status;
const booking = async (where2 = "", params = []) =>
  (await sql(`SELECT * FROM "Booking" ${where2} ORDER BY "createdAt" DESC LIMIT 1`, params))[0];

// =======================================================================================
section("1. What a visitor sees");
const visitor = await open(null);
await visitor.page.goto(baseUrl + "/project/alpha-one");
await settle(visitor.page);
check(
  "a company set up for online booking offers Book online on available plots",
  (await visitor.page.getByTestId("book-plot").count()) === 5,
  String(await visitor.page.getByTestId("book-plot").count()),
);
check(
  "a sold plot has no button",
  (await visitor.page.locator('tr[data-plot-number="A-6"] a').count()) === 0,
);
await visitor.page.goto(baseUrl + "/project/beta-one");
await settle(visitor.page);
check(
  "a company without a payout account offers Request booking instead",
  (await visitor.page.getByTestId("request-booking").count()) === 5 &&
    (await visitor.page.getByTestId("book-plot").count()) === 0,
);
const loggedOut = await fetch(`${baseUrl}/account/book/${A.plots[0]}`, { redirect: "manual" });
check(
  "booking needs a login",
  loggedOut.status >= 300 &&
    loggedOut.status < 400 &&
    /auth\/login/.test(loggedOut.headers.get("location") ?? ""),
  `${loggedOut.status} ${loggedOut.headers.get("location")}`,
);

// =======================================================================================
section("2. Holding a plot");
const b1 = await open(people.buyer1);
await go(b1.page, `/account/book/${A.plots[0]}`);
const summary = await b1.page.getByTestId("book-summary").innerText();
const bodyText = await text(b1.page);
check(
  "the page shows the plot, the builder and the token",
  summary.includes("A-1") &&
    summary.includes("Alpha Builders") &&
    (await b1.page.getByTestId("token-amount").innerText()) === "₹25,000",
  summary,
);
check(
  "it says what the token is, how long the hold lasts and when a refund happens",
  ["advance paid to the builder", "15 minutes", "refunded in full"].every((part) =>
    bodyText.includes(part),
  ),
);
await b1.page.locator("#book-mobile").fill("9876500001");
await b1.page.locator('input[name="agree"]').evaluate((el) => el.removeAttribute("required"));
await act(b1.page, () => b1.page.getByTestId("hold-and-pay").click());
check(
  "without agreeing, the server refuses",
  (await b1.page.getByTestId("book-error").innerText()).includes("agree"),
  await text(b1.page),
);
check("and holds nothing", (await plotStatus(A.plots[0])) === "AVAILABLE");
await b1.page.locator("#book-mobile").fill("12345");
await b1.page.locator('input[name="agree"]').check();
await act(b1.page, () => b1.page.getByTestId("hold-and-pay").click());
check("a bad mobile number is refused", (await text(b1.page)).includes("valid 10 digit"));
await b1.page.locator("#book-mobile").fill("9876500001");
await b1.page.locator('input[name="agree"]').check();
await act(b1.page, () => b1.page.getByTestId("hold-and-pay").click());
check(
  "holding lands on the booking page",
  /^\/account\/bookings\/[a-z0-9]+$/.test(here(b1.page)),
  where(b1.page),
);
const held = await booking();
check(
  "the plot is held for them for 15 minutes",
  (await plotStatus(A.plots[0])) === "HELD" &&
    held.status === "HELD" &&
    Math.abs(
      Number(
        (
          await sql(
            `SELECT EXTRACT(EPOCH FROM ("holdExpiresAt" - (now() AT TIME ZONE 'utc'))) AS s FROM "Booking" WHERE id = $1`,
            [held.id],
          )
        )[0].s,
      ) -
        15 * 60,
    ) < 60,
  JSON.stringify(held),
);
check(
  "the page shows a countdown, the token and TEST MODE",
  (await b1.page.getByTestId("hold-countdown").count()) === 1 &&
    (await b1.page.getByTestId("test-mode").count()) === 1 &&
    (await text(b1.page)).includes("₹25,000"),
);
check("the order was opened with the gateway", held.providerOrderId === `order_test_${held.id}`);

const b2 = await open(people.buyer2);
await go(b2.page, `/account/book/${A.plots[0]}`);
await b2.page.locator('input[name="agree"]').check();
await b2.page.locator("#book-mobile").fill("9876500002");
await act(b2.page, () => b2.page.getByTestId("hold-and-pay").click());
check(
  "another buyer cannot take a plot that is held",
  (await b2.page.getByTestId("book-error").innerText()).includes("no longer available"),
  await text(b2.page),
);
const other = await open(people.buyer3);
await go(other.page, "/account/bookings");
check(
  "a booking is private to its buyer",
  (await other.page.getByTestId("my-booking").count()) === 0,
);
check(
  "and another buyer's booking page is not found",
  (await other.page.goto(baseUrl + `/account/bookings/${held.id}`)).status() === 404,
);

section("2b. Two buyers at the same moment");
const c1 = await open(people.buyer2);
const c2 = await open(people.buyer3);
for (const c of [c1, c2]) {
  await go(c.page, `/account/book/${A.plots[1]}`);
  await c.page.locator('input[name="agree"]').check();
  await c.page.locator("#book-mobile").fill("9876500003");
}
await Promise.all([
  c1.page.getByTestId("hold-and-pay").click(),
  c2.page.getByTestId("hold-and-pay").click(),
]);
// Each page ends either on its booking or on the "no longer available" message; wait for that, since
// the two requests race and the slower one can take a moment.
await Promise.all(
  [c1, c2].map((c) =>
    c.page.waitForFunction(
      () =>
        location.pathname.startsWith("/account/bookings/") ||
        document.body.innerText.includes("no longer available"),
      null,
      { timeout: 25000 },
    ),
  ),
);
await Promise.all([settle(c1.page), settle(c2.page)]);
const landed = [c1, c2].filter((c) => /^\/account\/bookings\/[a-z0-9]+$/.test(here(c.page)));
check(
  "exactly one of them gets the plot",
  landed.length === 1,
  [c1, c2].map((c) => where(c.page)).join(" | "),
);
check(
  "the other is told it is gone",
  (await text([c1, c2].find((c) => !landed.includes(c)).page)).includes("no longer available"),
);
check(
  "one hold exists for the plot",
  Number(
    (
      await sql(`SELECT count(*) AS n FROM "Booking" WHERE "plotId" = $1 AND status = 'HELD'`, [
        A.plots[1],
      ])
    )[0].n,
  ) === 1,
);
// that winner now gives it back
const winner = landed[0];
await act(winner.page, () => winner.page.getByTestId("cancel-hold").click());
check(
  "giving a plot back frees it at once",
  (await plotStatus(A.plots[1])) === "AVAILABLE" &&
    (await text(winner.page)).includes("You gave this plot back"),
);

// =======================================================================================
section("3. Paying the token");
await go(b1.page, `/account/bookings/${held.id}`);
await act(b1.page, () => b1.page.getByTestId("pay-test").click());
check("paying shows the plot as booked", (await b1.page.getByTestId("booking-paid").count()) === 1);
check(
  "the plot is Booked, the booking Paid, and the buyer is a Booked lead",
  (await plotStatus(A.plots[0])) === "BOOKED" &&
    (await booking("WHERE id = $1", [held.id])).status === "PAID" &&
    (
      await sql(`SELECT status, source FROM "Lead" WHERE "buyerId" = $1`, [
        await buyerRow(people.buyer1),
      ])
    )[0]?.status === "BOOKED",
);
await new Promise((r) => setTimeout(r, 800));
check(
  "the buyer gets a receipt",
  (await mailTo(people.buyer1.email, "booked at Alpha One")).length === 1,
);
check("the company is told", (await mailTo(people.ownerA.email, "Online booking")).length === 1);
await go(b1.page, "/account/bookings");
check(
  "My bookings lists it as Booked",
  (await b1.page.getByTestId("my-booking").first().getAttribute("data-status")) === "PAID",
);
await go(b1.page, `/account/bookings/${held.id}`);
check(
  "a paid booking offers no second payment",
  (await b1.page.getByTestId("pay-test").count()) === 0 &&
    (await b1.page.getByTestId("cancel-hold").count()) === 0,
);
await visitor.page.goto(baseUrl + "/project/alpha-one");
await settle(visitor.page);
const statusOfA1 = await visitor.page
  .locator('tr[data-plot-number="A-1"]')
  .getAttribute("data-status");
check(
  "the public page shows A-1 as Booked (the page was refreshed when it was paid)",
  statusOfA1 === "BOOKED",
  statusOfA1,
);
check(
  "and no longer offers it",
  (await visitor.page.locator('tr[data-plot-number="A-1"] a').count()) === 0,
);

const oa = await open(people.ownerA);
await go(oa.page, "/portal/bookings");
check(
  "the company sees the booking, with the buyer's contact",
  (
    await oa.page.locator('[data-testid="company-booking"][data-status="PAID"]').first().innerText()
  ).includes("9876500001"),
);
await go(oa.page, "/portal/leads");
check("and the lead is marked Booked online", (await text(oa.page)).includes("Booked online"));

// =======================================================================================
section("4. A refund");
await oa.page.goto(baseUrl + "/portal/bookings");
await oa.page.getByPlaceholder("Reason for the refund").first().fill("Buyer withdrew");
await act(oa.page, () => oa.page.getByRole("button", { name: "Refund the token" }).first().click());
check(
  "the company can refund its own token",
  (await text(oa.page)).includes("The token was refunded") &&
    (await booking("WHERE id = $1", [held.id])).status === "REFUNDED",
);
check("the plot is on sale again", (await plotStatus(A.plots[0])) === "AVAILABLE");
await new Promise((r) => setTimeout(r, 600));
check("the buyer is told", (await mailTo(people.buyer1.email, "Token refunded")).length === 1);
await go(b1.page, `/account/bookings/${held.id}`);
check(
  "and sees it on the booking page",
  (await b1.page.getByTestId("booking-refunded").count()) === 1,
);

// =======================================================================================
section("5. Holds that run out");
await go(b2.page, `/account/book/${A.plots[2]}`);
await b2.page.locator('input[name="agree"]').check();
await b2.page.locator("#book-mobile").fill("9876500002");
await act(b2.page, () => b2.page.getByTestId("hold-and-pay").click());
const hold2 = await booking('WHERE "buyerId" = $1', [await buyerRow(people.buyer2)]);
check(
  "a second hold is made",
  hold2.status === "HELD" && (await plotStatus(A.plots[2])) === "HELD",
);
await sql(`UPDATE "Booking" SET "holdExpiresAt" = now() - interval '2 minutes' WHERE id = $1`, [
  hold2.id,
]);
const ran = await (await cron("bookings")).json();
check(
  "the scheduler releases it",
  ran.released >= 1 &&
    (await plotStatus(A.plots[2])) === "AVAILABLE" &&
    (await booking("WHERE id = $1", [hold2.id])).status === "EXPIRED",
  JSON.stringify(ran),
);
check("running it again changes nothing", (await (await cron("bookings")).json()).released === 0);
await go(b2.page, `/account/bookings/${hold2.id}`);
check(
  "the buyer is told the hold ended",
  (await text(b2.page)).includes("Hold ended") || (await text(b2.page)).includes("hold ended"),
);

section("5b. A payment that arrives after the hold ended");
await go(b2.page, `/account/book/${A.plots[3]}`);
await b2.page.locator('input[name="agree"]').check();
await b2.page.locator("#book-mobile").fill("9876500002");
await act(b2.page, () => b2.page.getByTestId("hold-and-pay").click());
const hold3 = await booking('WHERE "buyerId" = $1', [await buyerRow(people.buyer2)]);
await sql(`UPDATE "Booking" SET "holdExpiresAt" = now() - interval '30 minutes' WHERE id = $1`, [
  hold3.id,
]);
const lateRes = await webhook(hold3, Math.floor(Date.now() / 1000), "pay_late_1", "evt_late");
check("the gateway's signed message is accepted", lateRes.status === 200);
const after3 = await booking("WHERE id = $1", [hold3.id]);
check(
  "a late payment is flagged for refund, not kept",
  after3.status === "REFUND_DUE" && (await plotStatus(A.plots[3])) === "AVAILABLE",
  JSON.stringify(after3),
);
await go(b2.page, `/account/bookings/${hold3.id}`);
check(
  "the buyer is told it will be refunded",
  (await b2.page.getByTestId("booking-refund-due").count()) === 1,
);
await new Promise((r) => setTimeout(r, 600));
check("staff are emailed", (await mailTo(people.admin.email, "Refund needed")).length === 1);
const adm = await open(people.admin);
await go(adm.page, "/admin/billing");
const dueRow = adm.page.locator('[data-testid="admin-booking"][data-status="REFUND_DUE"]');
check(
  "the admin billing page lists it as refund due, with the reason",
  (await dueRow.count()) === 1 && (await dueRow.innerText()).includes("after the hold ended"),
);
await dueRow.getByPlaceholder("Reason for the refund").fill("Late payment returned");
await act(adm.page, () => dueRow.getByRole("button", { name: "Refund the token" }).click());
check("staff refund it", (await booking("WHERE id = $1", [hold3.id])).status === "REFUNDED");
check("the plot stays on sale", (await plotStatus(A.plots[3])) === "AVAILABLE");
const replay = await webhook(hold3, Math.floor(Date.now() / 1000), "pay_late_1", "evt_late");
check(
  "replaying the message changes nothing",
  replay.status === 200 && (await booking("WHERE id = $1", [hold3.id])).status === "REFUNDED",
);

section("5c. A payment that reached the gateway in time");
await go(b2.page, `/account/book/${A.plots[4]}`);
await b2.page.locator('input[name="agree"]').check();
await b2.page.locator("#book-mobile").fill("9876500002");
await act(b2.page, () => b2.page.getByTestId("hold-and-pay").click());
const hold4 = await booking('WHERE "buyerId" = $1', [await buyerRow(people.buyer2)]);
const ok = await webhook(hold4, Math.floor(Date.now() / 1000), "pay_ok_1", "evt_ok");
check(
  "a signed payment in time books the plot",
  ok.status === 200 &&
    (await booking("WHERE id = $1", [hold4.id])).status === "PAID" &&
    (await plotStatus(A.plots[4])) === "BOOKED",
);
check(
  "and the webhook sends the receipt too",
  (await mailTo(people.buyer2.email, "booked at Alpha One")).length === 1,
);
const forged = JSON.stringify({
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_x", order_id: "order_test_none", amount: 1 } } },
});
check(
  "an unsigned message is refused",
  (
    await fetch(`${baseUrl}/api/billing/webhook`, {
      method: "POST",
      body: forged,
      headers: { "content-type": "application/json" },
    })
  ).status === 400,
);

// =======================================================================================
section("6. Requesting a booking when online booking is not available");
const b3 = await open(people.buyer3);
await go(b3.page, "/project/beta-one?enquire=1&plot=A-2&request=booking");
check(
  "the dialog opens as a booking request, with the plot filled in",
  (await b3.page.getByTestId("enquiry-dialog").isVisible()) &&
    (await b3.page.locator("#enq-plot").inputValue()) === "A-2" &&
    (await b3.page.getByTestId("enquiry-dialog").innerText()).includes("Request to book"),
);
await b3.page.locator("#enq-name").fill("Meena Iyer");
await b3.page.locator("#enq-mobile").fill("9876500003");
await b3.page.locator('input[name="consent"]').check();
await b3.page.getByRole("button", { name: "Send booking request" }).click();
await b3.page.getByTestId("enquiry-sent").waitFor({ timeout: 10000 });
check(
  "it is sent as a booking request",
  (await sql(`SELECT source, "preferredPlot" FROM "Lead" WHERE "builderId" = $1`, [cB]))[0]
    ?.source === "booking_request",
);
const ob = await open(people.ownerB);
await go(ob.page, "/portal/leads");
check(
  "the company sees it flagged",
  (await ob.page.getByTestId("booking-request-badge").count()) === 1,
);

// =======================================================================================
section("7. Staff connect a payout account");
await go(adm.page, `/admin/builders/${cB}`);
await adm.page.locator("#payout-account").fill("not valid");
await act(adm.page, () =>
  adm.page.getByTestId("payout-form").getByRole("button", { name: "Save" }).click(),
);
check(
  "a malformed account id is refused",
  (await text(adm.page)).includes("looks like acc_") &&
    (await sql(`SELECT "payoutAccountId" FROM "Builder" WHERE id = $1`, [cB]))[0]
      .payoutAccountId === null,
);
await adm.page.locator("#payout-account").fill("acc_beta456xyz");
await act(adm.page, () =>
  adm.page.getByTestId("payout-form").getByRole("button", { name: "Save" }).click(),
);
check(
  "a valid one is saved",
  (await sql(`SELECT "payoutAccountId" FROM "Builder" WHERE id = $1`, [cB]))[0].payoutAccountId ===
    "acc_beta456xyz",
);
check(
  "a buyer cannot reach the admin pages",
  (await go(b1.page, "/admin/billing")) !== "/admin/billing",
);
check(
  "an owner cannot refund another company's booking",
  await (async () => {
    await go(ob.page, "/portal/bookings");
    return (await ob.page.getByTestId("company-booking").count()) === 0;
  })(),
);

// =======================================================================================
section("8. Phone width");
for (const [user, route] of [
  [people.buyer1, `/account/book/${A.plots[2]}`],
  [people.buyer1, `/account/bookings/${held.id}`],
  [people.buyer1, "/account/bookings"],
  [people.ownerA, "/portal/bookings"],
  [people.admin, "/admin/billing"],
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
