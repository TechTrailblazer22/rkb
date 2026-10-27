// End-to-end check of paying for a plan: checkout, the (test) gateway, invoices, upgrades with
// credit, scheduled downgrades, cancelling, the gateway's webhook, refunds and who may see what,
// in a real browser against a real Postgres. See docs/BILLING.md and docs/TESTING.md.
//
//   node tests/e2e/billing.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <DATABASE_URL> <mailOutboxDir> <BILLING_TEST_SECRET>
//
// The server must run a production build with BILLING_DRIVER=test and the same BILLING_TEST_SECRET,
// BILLING_SUPPLIER_STATE="Tamil Nadu", BILLING_SUPPLIER_GSTIN set, MAIL_DRIVER=file with
// MAIL_OUTBOX_DIR set to the folder passed here, ADMIN_EMAILS=admin@test.example and an EMPTY
// database. The test gateway moves no money: it signs like the real one, so this suite can play the
// gateway by posting signed webhooks.
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const [, , projectDir, baseUrl, secret, databaseUrl, outboxDir, gatewaySecret] = process.argv;
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
  sub: `auth0|b-${key}`,
  email: `${key}@test.example`,
  email_verified: true,
  name,
});
const people = {
  admin: person("admin", "Admin"),
  ownerA: person("ownera", "Owner A"),
  ownerB: person("ownerb", "Owner B"),
  ownerC: person("ownerc", "Owner C"),
  manager: person("manager", "Mina Manager"),
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
/** Clicks something that posts a server action, and waits until the page it redirects to is showing. */
async function act(page, click) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 15000 }),
    click(),
  ]);
  await page.waitForTimeout(700);
  await settle(page);
}
const mailTo = async (address, subjectPart) => {
  try {
    const lines = (await readFile(path.join(outboxDir, "mail-outbox.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return lines.filter(
      (m) => [].concat(m.to).includes(address) && m.subject.includes(subjectPart),
    );
  } catch {
    return [];
  }
};
const sign = (body, key = gatewaySecret) => createHmac("sha256", key).update(body).digest("hex");
const webhook = (body, headers = {}) =>
  fetch(`${baseUrl}/api/billing/webhook`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });

// ---------------------------------------------------------------------------------------
async function company(name, slug, owner, state, plan) {
  const builderId = id();
  await sql(
    `INSERT INTO "Builder"(id,"companyName",status,slug,state,city,gstin,"verifiedAt","updatedAt") VALUES($1,$2,'VERIFIED',$3,$4,'Somewhere','33ABCDE1234F1Z5',now(),now())`,
    [builderId, name, slug, state],
  );
  if (plan) {
    await sql(
      `INSERT INTO "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt") VALUES($1,$2,$3,'COMP',now(),now()+interval '30 days',now())`,
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
  return builderId;
}
async function project(builderId, slug, name, status = "DRAFT") {
  const projectId = id();
  await sql(
    `INSERT INTO "Project"(id,"builderId",slug,status,name,type,stage,"updatedAt") VALUES($1,$2,$3,$4,$5,'PLOTTED','READY_TO_MOVE',now())`,
    [projectId, builderId, slug, status, name],
  );
  return projectId;
}
const cA = await company("Alpha Builders", "alpha", people.ownerA, "Tamil Nadu", null);
const cB = await company("Beta Builders", "beta", people.ownerB, "Karnataka", null);
const cC = await company("Gamma Builders", "gamma", people.ownerC, "Tamil Nadu", "GROWTH");
const gammaProjects = [];
for (const n of [1, 2, 3]) gammaProjects.push(await project(cC, `gamma-${n}`, `Gamma ${n}`));
// a manager in company A
const managerId = id();
await sql(
  `INSERT INTO "User"(id,"auth0Sub",email,name,role,"updatedAt") VALUES($1,$2,$3,$4,'BUILDER_TEAM',now())`,
  [managerId, people.manager.sub, people.manager.email, people.manager.name],
);
await sql(`INSERT INTO "BuilderMember"(id,"builderId","userId",role) VALUES($1,$2,$3,'MANAGER')`, [
  id(),
  cA,
  managerId,
]);

// =======================================================================================
section("1. Buying a first plan (same state: CGST and SGST)");
const a = await open(people.ownerA);
await go(a.page, "/portal/billing");
check(
  "the page offers plans, with online payment",
  (await a.page.getByTestId("no-online-payment").count()) === 0 &&
    !(await a.page.getByTestId("buy-GROWTH-MONTHLY").isDisabled()),
);
check(
  "the button says what it costs",
  (await a.page.getByTestId("buy-GROWTH-MONTHLY").innerText()).includes("pay ₹9,438.82"),
  await a.page.getByTestId("buy-GROWTH-MONTHLY").innerText(),
);
await act(a.page, () => a.page.getByTestId("buy-GROWTH-MONTHLY").click());
check(
  "it leads to the payment page",
  /^\/portal\/billing\/pay\/[a-z0-9]+$/.test(here(a.page)),
  where(a.page),
);
check(
  "the page says TEST MODE, loudly",
  (await a.page.getByTestId("test-mode").innerText()).includes("No money moves"),
);
const summary = await a.page.getByTestId("order-summary").innerText();
check(
  "the summary shows list price, CGST 9%, SGST 9% and the total",
  summary.includes("₹7,999") &&
    summary.includes("CGST 9%") &&
    summary.includes("SGST 9%") &&
    !summary.includes("IGST") &&
    summary.includes("₹9,438.82"),
  summary,
);
const orderRow = (await sql(`SELECT * FROM "PaymentOrder" WHERE "builderId" = $1`, [cA]))[0];
check(
  "the order records the amounts and the gateway",
  orderRow.totalPaise === 943882 &&
    orderRow.status === "CREATED" &&
    orderRow.provider === "test" &&
    orderRow.providerOrderId === `order_test_${orderRow.id}`,
  JSON.stringify(orderRow),
);
const payUrl = where(a.page);

await act(a.page, () => a.page.getByRole("button", { name: /Pay .* \(test\)/ }).click());
check(
  "paying lands on the billing page with a confirmation",
  here(a.page) === "/portal/billing" && (await text(a.page)).includes("Payment received"),
  where(a.page),
);
const card = await a.page.getByTestId("plan-card").innerText();
check(
  "the plan is Growth and paid until a date",
  card.includes("Growth plan") && card.includes("Paid until"),
  card,
);
const inv1 = (await sql(`SELECT * FROM "Invoice" WHERE "builderId" = $1`, [cA]))[0];
check(
  "an invoice was made, with the right tax",
  inv1.totalPaise === 943882 &&
    inv1.cgstPaise === 71991 &&
    inv1.sgstPaise === 71991 &&
    inv1.igstPaise === 0 &&
    /^RKB\/\d{4}-\d{2}\/0001$/.test(inv1.number),
  JSON.stringify(inv1),
);
check(
  "it names the supplier and the company, as they were at the time",
  inv1.supplier?.gstin === "33AAAAA0000A1Z5" && inv1.billTo?.name === "Alpha Builders",
  JSON.stringify([inv1.supplier, inv1.billTo]),
);
check(
  "the order is paid and linked to the invoice",
  (await sql(`SELECT status, "invoiceId" FROM "PaymentOrder" WHERE id = $1`, [orderRow.id]))[0]
    .invoiceId === inv1.id,
);
check(
  "the receipt is emailed",
  (await mailTo(people.ownerA.email, "Payment received")).length === 1,
);
check(
  "the plan summary on the overview agrees",
  await (async () => {
    await go(a.page, "/portal");
    return (await a.page.getByTestId("plan-summary").innerText()).includes("Growth plan");
  })(),
);

await go(a.page, payUrl);
check("the finished payment page sends you back to billing", here(a.page) === "/portal/billing");

// =======================================================================================
section("2. The invoice page");
await go(a.page, "/portal/billing");
await a.page.getByRole("link", { name: inv1.number }).click();
await settle(a.page);
check("an invoice opens from the list", here(a.page) === `/portal/billing/invoices/${inv1.id}`);
const invText = await text(a.page);
check(
  "it shows the number, both taxes, SAC, the company's GSTIN and the total",
  [
    inv1.number,
    "CGST 9%",
    "SGST 9%",
    "998439",
    "33ABCDE1234F1Z5",
    "₹9,438.82",
    "Alpha Builders",
    "33AAAAA0000A1Z5",
  ].every((s) => invText.includes(s)),
  invText.slice(0, 400),
);
check(
  "there is a print button",
  (await a.page.getByRole("button", { name: /Print/ }).count()) === 1,
);
const printed = await a.page.evaluate(() => {
  const style = [...document.styleSheets].flatMap((s) => {
    try {
      return [...s.cssRules];
    } catch {
      return [];
    }
  });
  return style.some(
    (rule) =>
      rule.constructor.name === "CSSMediaRule" &&
      /print/.test(rule.conditionText ?? rule.media.mediaText),
  );
});
check("and print styles that hide the site header", printed);

const b = await open(people.ownerB);
check(
  "another company's owner cannot open it",
  (
    await b.page
      .goto(`${baseUrl}/portal/billing/invoices/${inv1.id}`)
      .then(() => acceptTermsIfAsked(b.page))
      .then(() => b.page.goto(`${baseUrl}/portal/billing/invoices/${inv1.id}`))
  ).status() === 404,
);
const loggedOut = await fetch(`${baseUrl}/portal/billing/invoices/${inv1.id}`, {
  redirect: "manual",
});
check(
  "a visitor who is not logged in is sent to log in",
  loggedOut.status >= 300 &&
    loggedOut.status < 400 &&
    /\/auth\/login\?returnTo=/.test(loggedOut.headers.get("location") ?? ""),
  `${loggedOut.status} ${loggedOut.headers.get("location")}`,
);
const mgr = await open(people.manager);
check(
  "a manager is sent back to the portal",
  (await go(mgr.page, `/portal/billing/invoices/${inv1.id}`)) === "/portal",
  where(mgr.page),
);
check(
  "and cannot open the payment page or billing",
  (await go(mgr.page, payUrl)) === "/portal" &&
    (await go(mgr.page, "/portal/billing")) === "/portal",
);

// =======================================================================================
section("3. Another state pays IGST");
await go(b.page, "/portal/billing");
await act(b.page, () => b.page.getByTestId("buy-STARTER-ANNUAL").click());
const sumB = await b.page.getByTestId("order-summary").innerText();
check(
  "the summary shows IGST 18% and no CGST",
  sumB.includes("IGST 18%") && !sumB.includes("CGST") && sumB.includes("₹29,990"),
  sumB,
);
const orderB = (await sql(`SELECT * FROM "PaymentOrder" WHERE "builderId" = $1`, [cB]))[0];
check(
  "a year of Starter is ten months: 29,990 plus 5,398.20",
  orderB.subtotalPaise === 2999000 && orderB.totalPaise === 3538820,
  JSON.stringify(orderB),
);

// =======================================================================================
section("4. The gateway's webhook");
const bodyFor = (
  order,
  amount = order.totalPaise,
  paymentId = "pay_wh_1",
  type = "payment.captured",
) =>
  JSON.stringify({
    event: type,
    payload: { payment: { entity: { id: paymentId, order_id: order.providerOrderId, amount } } },
  });
const raw = bodyFor(orderB);
check("a message with no signature is refused", (await webhook(raw)).status === 400);
check(
  "one signed with the wrong secret is refused",
  (await webhook(raw, { "x-razorpay-signature": sign(raw, "not-the-secret-0123456789") }))
    .status === 400,
);
check(
  "a changed body does not match its signature",
  (await webhook(raw.replace("pay_wh_1", "pay_wh_2"), { "x-razorpay-signature": sign(raw) }))
    .status === 400,
);
check(
  "nothing was applied by any of those",
  (await sql(`SELECT 1 FROM "Subscription" WHERE "builderId" = $1`, [cB])).length === 0,
);
const wrongAmount = bodyFor(orderB, orderB.totalPaise - 100);
check(
  "a payment of the wrong amount is acknowledged but not applied",
  (
    await webhook(wrongAmount, {
      "x-razorpay-signature": sign(wrongAmount),
      "x-razorpay-event-id": "evt_wrong",
    })
  ).status === 200 &&
    (await sql(`SELECT 1 FROM "Subscription" WHERE "builderId" = $1`, [cB])).length === 0,
);
check(
  "and is flagged for staff",
  (await sql(`SELECT 1 FROM "AuditLog" WHERE action = 'payment.amount_mismatch'`)).length === 1,
);
const good = await webhook(raw, {
  "x-razorpay-signature": sign(raw),
  "x-razorpay-event-id": "evt_ok",
});
check(
  "a correct one is accepted and applies the plan",
  good.status === 200 &&
    (await sql(`SELECT plan, interval FROM "Subscription" WHERE "builderId" = $1`, [cB]))[0]
      ?.plan === "STARTER",
);
const again = await webhook(raw, {
  "x-razorpay-signature": sign(raw),
  "x-razorpay-event-id": "evt_ok",
});
check(
  "the same event again changes nothing",
  again.status === 200 && (await again.json()).note === "already handled",
);
const replay = await webhook(raw, {
  "x-razorpay-signature": sign(raw),
  "x-razorpay-event-id": "evt_replayed",
});
check(
  "the same payment under a new event id changes nothing either",
  replay.status === 200 &&
    (await sql(`SELECT 1 FROM "Invoice" WHERE "builderId" = $1`, [cB])).length === 1,
);
const invB = (await sql(`SELECT * FROM "Invoice" WHERE "builderId" = $1`, [cB]))[0];
check(
  "the invoice is IGST",
  invB.igstPaise === 539820 && invB.cgstPaise === 0,
  JSON.stringify(invB),
);
check(
  "the company was emailed once",
  (await mailTo(people.ownerB.email, "Payment received")).length === 1,
);
check("only POST is allowed", (await fetch(`${baseUrl}/api/billing/webhook`)).status === 405);
await go(b.page, "/portal/billing");
check(
  "the company sees the plan without paying twice through the page",
  (await b.page.getByTestId("plan-card").innerText()).includes("Starter plan"),
);

// =======================================================================================
section("5. Upgrading credits the unused part");
await go(a.page, "/portal/billing");
const upgradeLabel = await a.page.getByTestId("buy-PREMIER-MONTHLY").innerText();
check(
  "the button shows an upgrade with a credit",
  upgradeLabel.includes("Upgrade") && upgradeLabel.includes("credit"),
  upgradeLabel,
);
await act(a.page, () => a.page.getByTestId("buy-PREMIER-MONTHLY").click());
const upSummary = await a.page.getByTestId("order-summary").innerText();
check(
  "the payment page shows the credit as a line",
  upSummary.includes("Credit for the unused part"),
  upSummary,
);
const upOrder = (
  await sql(
    `SELECT * FROM "PaymentOrder" WHERE "builderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [cA],
  )
)[0];
check(
  "the order is an upgrade, below the list price by the credit",
  upOrder.change === "UPGRADE" &&
    upOrder.creditPaise > 700000 &&
    upOrder.creditPaise <= 799900 &&
    upOrder.subtotalPaise === 1999900 - upOrder.creditPaise,
  JSON.stringify(upOrder),
);
await act(a.page, () => a.page.getByRole("button", { name: /Pay .* \(test\)/ }).click());
check(
  "after paying the plan is Premier",
  (await a.page.getByTestId("plan-card").innerText()).includes("Premier plan"),
);
const subA = (await sql(`SELECT * FROM "Subscription" WHERE "builderId" = $1`, [cA]))[0];
check(
  "the paid amount for the period is the net amount",
  subA.paidSubtotalPaise === upOrder.subtotalPaise,
  String(subA.paidSubtotalPaise),
);
check(
  "invoice numbers run on without a gap",
  (await sql(`SELECT number FROM "Invoice" ORDER BY number`))
    .map((r) => r.number.split("/")[2])
    .join() === "0001,0002,0003",
);
check(
  "the invoice mentions the credit",
  (
    await sql(
      `SELECT description FROM "Invoice" WHERE "builderId" = $1 ORDER BY "issuedAt" DESC LIMIT 1`,
      [cA],
    )
  )[0].description.includes("credit"),
);

section("5b. Renewing early adds time and loses none");
await go(a.page, "/portal/billing");
const before = (
  await sql(`SELECT "currentPeriodEnd" FROM "Subscription" WHERE "builderId" = $1`, [cA])
)[0].currentPeriodEnd;
await act(a.page, () => a.page.getByTestId("buy-PREMIER-MONTHLY").click());
check(
  "renewing the same plan is a renewal",
  (
    await sql(
      `SELECT change FROM "PaymentOrder" WHERE "builderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [cA],
    )
  )[0].change === "RENEW",
);
await act(a.page, () => a.page.getByRole("button", { name: /Pay .* \(test\)/ }).click());
const after = (
  await sql(`SELECT "currentPeriodEnd" FROM "Subscription" WHERE "builderId" = $1`, [cA])
)[0].currentPeriodEnd;
const days = (after - before) / 86400000;
check("the end moved by one more month", days >= 28 && days <= 31, String(days));

section("5c. A second checkout replaces the first");
await go(a.page, "/portal/billing");
await act(a.page, () => a.page.getByTestId("buy-PREMIER-MONTHLY").click());
const firstPay = where(a.page);
await go(a.page, "/portal/billing");
await act(a.page, () => a.page.getByTestId("buy-PREMIER-ANNUAL").click());
const livePay = where(a.page);
await go(a.page, firstPay);
check(
  "the older payment page says it was replaced",
  (await text(a.page)).includes("replaced by a newer one") &&
    (await a.page.getByRole("button", { name: /\(test\)/ }).count()) === 0,
);

// =======================================================================================
section("6. A cheaper plan waits for the renewal, and is refused while over its limits");
const c = await open(people.ownerC);
await go(c.page, "/portal/billing");
const downLabel = await c.page.getByTestId("buy-STARTER-MONTHLY").innerText();
check("the button says it switches at renewal", downLabel.includes("Switch at renewal"), downLabel);
await act(c.page, () => c.page.getByTestId("buy-STARTER-MONTHLY").click());
check(
  "three projects do not fit Starter: the page says what to do",
  (await c.page.getByTestId("billing-blockers").innerText()).includes("Archive 1 project"),
  await text(c.page),
);
check(
  "nothing was scheduled",
  (await sql(`SELECT "pendingPlan" FROM "Subscription" WHERE "builderId" = $1`, [cC]))[0]
    .pendingPlan === null,
);
await sql(`UPDATE "Project" SET status = 'ARCHIVED' WHERE id = $1`, [gammaProjects[0]]);
await go(c.page, "/portal/billing");
await act(c.page, () => c.page.getByTestId("buy-STARTER-MONTHLY").click());
check(
  "after archiving one it is scheduled",
  (await c.page.getByTestId("pending-change").innerText()).includes("Starter"),
  await text(c.page),
);
check(
  "and no payment was asked for",
  (await sql(`SELECT 1 FROM "PaymentOrder" WHERE "builderId" = $1`, [cC])).length === 0,
);
await act(c.page, () => c.page.getByRole("button", { name: "Withdraw" }).click());
check(
  "it can be withdrawn",
  (await c.page.getByTestId("pending-change").count()) === 0 &&
    (await sql(`SELECT "pendingPlan" FROM "Subscription" WHERE "builderId" = $1`, [cC]))[0]
      .pendingPlan === null,
);

section("6b. Not renewing");
await act(c.page, () => c.page.getByTestId("cancel-renewal").click());
check(
  "the plan says it will end, and for when",
  (await c.page.getByTestId("cancel-note").innerText()).includes("You chose not to renew"),
);
check(
  "it stays active",
  (await c.page.getByTestId("plan-card").innerText()).includes("Growth plan"),
);
await act(c.page, () => c.page.getByRole("button", { name: "Keep my plan" }).click());
check("the choice can be undone", (await c.page.getByTestId("cancel-note").count()) === 0);

// =======================================================================================
section("7. Staff: refunds and the billing overview");
const adm = await open(people.admin);
await go(adm.page, "/admin/billing");
const stats = await adm.page.getByTestId("billing-stats").innerText();
check(
  "the overview shows what was received this month",
  stats.includes("Received this month") && stats.includes("₹"),
  stats,
);
check(
  "recent payments and invoices are listed",
  (await adm.page.getByTestId("orders").count()) === 1 &&
    (await adm.page.getByTestId("admin-invoices").count()) === 1,
);
await adm.page.getByRole("link", { name: inv1.number }).click();
await settle(adm.page);
check(
  "staff can open any invoice",
  (await adm.page.getByTestId("invoice-number").innerText()) === inv1.number,
);
await go(adm.page, "/admin/billing");
const row = adm.page.locator("li", { hasText: inv1.number });
await row.getByPlaceholder("Reason for the refund").fill("Paid twice by mistake");
await act(adm.page, () => row.getByRole("button", { name: "Refund" }).click());
check(
  "a refund goes through the gateway and says so",
  (await text(adm.page)).includes("Refunded through the gateway (rfnd_test_pay_test_"),
  (await text(adm.page)).slice(0, 300),
);
check(
  "the invoice is marked refunded",
  (await sql(`SELECT status, "refundNote" FROM "Invoice" WHERE id = $1`, [inv1.id]))[0].status ===
    "REFUNDED",
);
await go(a.page, `/portal/billing/invoices/${inv1.id}`);
check("and the printed invoice says Refunded", (await text(a.page)).toLowerCase().includes("refunded"));
check(
  "a refund needs a reason (the server refuses an empty one)",
  await (async () => {
    await go(adm.page, "/admin/billing");
    const r = adm.page.locator("li", { hasText: invB.number });
    await r.getByPlaceholder("Reason for the refund").evaluate((el) => {
      el.removeAttribute("required");
      el.removeAttribute("minlength");
      el.value = "x";
    });
    await act(adm.page, () => r.getByRole("button", { name: "Refund" }).click());
    return (
      (await text(adm.page)).includes("Write a short reason") &&
      (await sql(`SELECT status FROM "Invoice" WHERE id = $1`, [invB.id]))[0].status === "PAID"
    );
  })(),
);
const notAdmin = await open(people.ownerA);
check(
  "an owner cannot open the admin billing page",
  (await go(notAdmin.page, "/admin/billing")) !== "/admin/billing",
);

// =======================================================================================
section("8. Phone width");
for (const [user, route] of [
  [people.ownerA, "/portal/billing"],
  [people.ownerA, `/portal/billing/invoices/${inv1.id}`],
  [people.ownerA, livePay],
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
