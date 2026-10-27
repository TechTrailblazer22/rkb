// End-to-end check of projects and plot inventory, in a real browser, against a real Postgres,
// with local file storage and the dev mail outbox. See docs/TESTING.md.
//
//   node tests/e2e/projects.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <mailOutboxDir> <DATABASE_URL>
//
// The server must run with STORAGE_DRIVER=local, MAIL_DRIVER=file and MAIL_OUTBOX_DIR set to the
// same folder, ADMIN_EMAILS=admin@test.example, and an EMPTY database.
//
// Company verification has its own test (builder-onboarding.mjs), so here the builder is made
// "verified" directly in the database at the point the test needs it.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const [, , projectDir, baseUrl, secret, outboxDir, databaseUrl] = process.argv;
const require = createRequire(path.join(projectDir, "package.json"));
const { chromium } = require("@playwright/test");
const { generateSessionCookie } = require("@auth0/nextjs-auth0/testing");
const { Client } = require("pg");
const writeExcelFile = require("write-excel-file/node").default ?? require("write-excel-file/node");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
};
const section = (title) => console.log(`\n--- ${title}`);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FAKE = Buffer.from("<html><script>alert('owned')</script></html>");

const people = {
  owner1: {
    sub: "auth0|p-owner1",
    email: "owner1@test.example",
    email_verified: true,
    name: "Anand Owner",
  },
  owner2: {
    sub: "auth0|p-owner2",
    email: "owner2@test.example",
    email_verified: true,
    name: "Second Owner",
  },
  buyer: {
    sub: "auth0|p-buyer",
    email: "buyer@test.example",
    email_verified: true,
    name: "Bina Buyer",
  },
  admin: {
    sub: "auth0|p-admin",
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
async function open(user, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  if (user) await context.addCookies([await cookieFor(user)]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept()); // the "are you sure?" prompts
  return { context, page };
}
const here = (page) => new URL(page.url()).pathname;
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
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

async function acceptTerms(page, startAt) {
  await page.goto(baseUrl + startAt);
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForLoadState("networkidle");
  }
}
async function waitSaved(page) {
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => document.body.innerText.includes("All changes saved"), null, {
    timeout: 15000,
  });
}
async function openDetails(page, title) {
  const details = page.locator("details", { has: page.locator("summary", { hasText: title }) });
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
}
const flash = async (page) =>
  (
    await page
      .locator('[role="status"], [role="alert"]')
      .first()
      .innerText()
      .catch(() => "")
  ).trim();
async function counts(page) {
  const dl = (await page.getByTestId("plot-counts").innerText()).replace(/\s+/g, " ");
  const n = (label) => Number((dl.match(new RegExp(`${label} (\\d+)`)) ?? [])[1]);
  return { total: n("Total"), available: n("Available"), booked: n("Booked"), sold: n("Sold") };
}

// =====================================================================
section("1. A builder starts a project (company not verified yet)");
const o1 = await open(people.owner1);
await acceptTerms(o1.page, "/start-listing");
await o1.page.getByRole("button", { name: "Create my builder account" }).click();
await o1.page.waitForURL(/\/portal$/);
check(
  "portal: has a Projects tab",
  (await o1.page.getByRole("link", { name: "Projects" }).count()) > 0,
);

await o1.page.goto(baseUrl + "/portal/projects");
check(
  "projects: explains that going live needs a verified company",
  (await text(o1.page)).includes("company is verified"),
);
await o1.page.locator("#name").fill("ab");
await o1.page.getByRole("button", { name: "Create" }).click();
await o1.page.waitForTimeout(800);
check("projects: a too-short name is not accepted", here(o1.page) === "/portal/projects");

await o1.page.locator("#name").fill("Green Valley Enclave");
await o1.page.locator("#type").selectOption("PLOTTED");
await o1.page.getByRole("button", { name: "Create" }).click();
await o1.page.waitForURL(/\/portal\/projects\/[^/]+\/basics$/);
const projectId = here(o1.page).split("/")[3];
// a plan in force (Growth: six projects, video, 40 photos); drafts do not need one, going live does
await sql(
  `insert into "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt")
   select gen_random_uuid()::text, "builderId", 'GROWTH', 'COMP', now(), now() + interval '60 days', now() from "Project" where id = $1`,
  [projectId],
);
const base = `/portal/projects/${projectId}`;
check("projects: creating one opens the wizard at step 1", here(o1.page) === `${base}/basics`);
check(
  "wizard: shows all ten steps",
  (await o1.page.locator('nav[aria-label="Project steps"] ol li').count()) === 10,
);
check(
  "wizard: starts low on completeness",
  Number(await o1.page.getByRole("progressbar").first().getAttribute("aria-valuenow")) < 15,
);

// =====================================================================
section("2. Basics, size and the autosave rules");
await o1.page.locator("#city").fill("Coimbatore");
await o1.page.locator("#locality").fill("Sulur");
await o1.page.locator("#addressLine").fill("Survey 12, Sulur Road");
await o1.page.locator("#description").fill("Short.");
await o1.page.locator("#mapUrl").fill("http://not-secure.example/map");
await waitSaved(o1.page);
check(
  "basics: an http map link is refused with a message",
  (await o1.page.locator("#mapUrl-error").count()) > 0,
);
await o1.page
  .locator("#description")
  .fill(
    "A DTCP approved plotted layout close to the bypass, with tar roads, street lights, drainage and a park.",
  );
await o1.page.locator("#mapUrl").fill("https://maps.google.com/?q=11.02,77.1");
await waitSaved(o1.page);
await o1.page.reload();
check(
  "basics: values survive a reload",
  (await o1.page.locator("#city").inputValue()) === "Coimbatore" &&
    (await o1.page.locator("#mapUrl").inputValue()).startsWith("https://maps.google.com"),
);
check(
  "basics: the refused link was not kept earlier",
  (await o1.page.locator("#mapUrl-error").count()) === 0,
);

await o1.page.goto(baseUrl + `${base}/layout`);
await o1.page.locator("#totalPlots").fill("lots");
await o1.page.locator("#acres").fill("12.5");
await o1.page.locator("#openAreaPercent").fill("15");
await waitSaved(o1.page);
check(
  "layout: a non-number total is refused, the others save",
  (await o1.page.locator("#totalPlots-error").count()) > 0 &&
    (await o1.page.locator("#acres").inputValue()) === "12.5",
);
await o1.page.locator("#totalPlots").fill("50");
await waitSaved(o1.page);

// =====================================================================
section("3. Plots: add, duplicate, series, import, statuses, edit, delete");
await o1.page.goto(baseUrl + `${base}/plots`);
await o1.page.locator("#add-number").fill("A-1");
await o1.page.locator("#add-sizeSqft").fill("1200");
await o1.page.locator("#add-ratePerSqft").fill("1850");
await o1.page.locator('[data-form="add-plot"]').getByRole("button", { name: "Add plot" }).click();
await o1.page.waitForURL(/saved=/);
check("plots: adding a plot confirms it", (await flash(o1.page)).includes("Plot A-1 added"));
check(
  "plots: its price is worked out from rate and size",
  (await o1.page.locator('[data-plot-number="A-1"]').innerText()).includes("22,20,000"),
);

await openDetails(o1.page, "Add a plot");
await o1.page.locator("#add-number").fill("a-1");
await o1.page.locator("#add-sizeSqft").fill("900");
await o1.page.locator('[data-form="add-plot"]').getByRole("button", { name: "Add plot" }).click();
await o1.page.waitForURL(/error=/);
check(
  "plots: the same number in another case is refused",
  (await flash(o1.page)).includes("already exist"),
);

await openDetails(o1.page, "Create a numbered series");
await o1.page.locator("#series-prefix").fill("B-");
await o1.page.locator("#series-start").fill("1");
await o1.page.locator("#series-end").fill("20");
await o1.page.locator("#series-size").fill("1500");
await o1.page.locator("#series-facing").selectOption("EAST");
await o1.page.locator("#series-rate").fill("1900");
await o1.page.locator('[data-form="series"]').getByRole("button", { name: "Create plots" }).click();
await o1.page.waitForURL(/saved=/);
check(
  "plots: a series of 20 is created at once",
  (await flash(o1.page)).includes("20 plots created") && (await counts(o1.page)).total === 21,
);

await o1.page.goto(baseUrl + `${base}/plots`);
await openDetails(o1.page, "Create a numbered series");
await o1.page.locator("#series-prefix").fill("B-");
await o1.page.locator("#series-start").fill("18");
await o1.page.locator("#series-end").fill("25");
await o1.page.locator("#series-size").fill("1500");
await o1.page.locator('[data-form="series"]').getByRole("button", { name: "Create plots" }).click();
await o1.page.waitForURL(/error=/);
check(
  "plots: a series that overlaps existing plots adds none of them",
  (await counts(o1.page)).total === 21,
);

// CSV import with deliberate mistakes
const csv = [
  "plot_number,size_sqft,facing,rate_per_sqft",
  "C-1,1000,East,1800",
  "C-2,abc,,",
  "A-1,900,,",
  "C-1,1100,,",
  "C-3,1100,North-East,1800",
].join("\n");
await o1.page.goto(baseUrl + `${base}/plots`);
await openDetails(o1.page, "Import from Excel or CSV");
await o1.page
  .locator("#plot-import-file")
  .setInputFiles({ name: "plots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await o1.page.getByTestId("import-preview").waitFor({ timeout: 15000 });
const previewText = await o1.page.getByTestId("import-preview").innerText();
check(
  "import: previews 2 good rows and 3 problems",
  /2 rows are ready/.test(previewText) && /3 have problems/.test(previewText),
  previewText.slice(0, 120),
);
check(
  "import: says exactly what is wrong on which row",
  previewText.includes("must be a number") &&
    previewText.includes("already exists") &&
    previewText.includes("is repeated"),
);
check("import: nothing is saved by the preview", (await counts(o1.page)).total === 21);
await o1.page.getByRole("button", { name: /Import the 2 valid rows/ }).click();
await o1.page.waitForFunction(() => document.body.innerText.includes("2 plots imported"), null, {
  timeout: 15000,
});
await settle(o1.page);
check("import: only the valid rows were added", (await counts(o1.page)).total === 23);

// Excel import
const xlsx = Buffer.from(
  await writeExcelFile([
    ["Plot No.", "Size (sq ft)", "Facing", "Rate per sq ft", "Status"],
    ["D-1", 1200, "West", 1700, "Available"],
    ["D-2", 1300, "North", 1700, "Sold"],
    ["D-3", 1400, "South", 1700, ""],
  ]).toBuffer(),
);
await o1.page.goto(baseUrl + `${base}/plots`);
await openDetails(o1.page, "Import from Excel or CSV");
await o1.page.locator("#plot-import-file").setInputFiles({
  name: "plots.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: xlsx,
});
await o1.page.getByTestId("import-preview").waitFor({ timeout: 15000 });
check(
  "import: an Excel file with different column names is understood",
  /3 rows are ready/.test(await o1.page.getByTestId("import-preview").innerText()),
);
await o1.page.getByRole("button", { name: /Import 3 plots/ }).click();
await o1.page.waitForFunction(() => document.body.innerText.includes("3 plots imported"), null, {
  timeout: 15000,
});
await settle(o1.page);
let c = await counts(o1.page);
check(
  "import: Excel rows added, with their statuses",
  c.total === 26 && c.sold === 1,
  JSON.stringify(c),
);

await openDetails(o1.page, "Import from Excel or CSV");
await o1.page.locator("#plot-import-file").setInputFiles({
  name: "evil.csv",
  mimeType: "text/csv",
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
});
await o1.page
  .getByText("Upload an Excel (.xlsx) or CSV file.")
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check(
  "import: a binary file is refused politely",
  (await text(o1.page)).includes("Upload an Excel (.xlsx) or CSV file."),
);

// bulk and inline status changes
await o1.page.goto(baseUrl + `${base}/plots`);
await o1.page.locator('input[name="plotId"][aria-label="Select plot B-1"]').check();
await o1.page.locator('input[name="plotId"][aria-label="Select plot B-2"]').check();
await o1.page.locator('[data-form="bulk"]').getByRole("button", { name: "Mark booked" }).click();
await o1.page.waitForURL(/saved=/);
check(
  "plots: ticking two plots and marking booked works",
  (await flash(o1.page)).includes("2 plots marked booked") && (await counts(o1.page)).booked === 2,
);

await o1.page.locator('[data-plot-number="C-1"] select').selectOption("SOLD");
await o1.page
  .waitForFunction(
    () => /Sold\s*2/.test(document.querySelector('[data-testid="plot-counts"]')?.textContent ?? ""),
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
await o1.page.waitForTimeout(500);
c = await counts(o1.page);
check("plots: the dropdown in a row changes one plot's status", c.sold === 2, JSON.stringify(c));

await o1.page.locator("#filter-status").selectOption("BOOKED");
await o1.page.getByRole("button", { name: "Filter" }).click();
await o1.page.waitForLoadState("networkidle");
check(
  "plots: filtering by status shows only those",
  (await o1.page.locator("tbody tr").count()) === 2,
);
await o1.page.goto(baseUrl + `${base}/plots?q=B-1`);
check(
  "plots: searching a number finds it (and B-10 to B-19)",
  (await o1.page.locator("tbody tr").count()) === 11,
);

// edit
await o1.page.goto(baseUrl + `${base}/plots`);
await o1.page.locator('[data-plot-number="A-1"]').getByRole("link", { name: "Edit" }).click();
await o1.page.locator("#edit-sizeSqft").fill("1800");
await o1.page
  .locator('[data-form="edit-plot"]')
  .getByRole("button", { name: "Save changes" })
  .click();
await o1.page.waitForURL(/saved=/);
check(
  "plots: editing a plot saves the new size",
  (await o1.page.locator('[data-plot-number="A-1"]').innerText()).includes("1,800"),
);
await o1.page.locator('[data-plot-number="A-1"]').getByRole("link", { name: "Edit" }).click();
await o1.page.locator("#edit-number").fill("b-3");
await o1.page
  .locator('[data-form="edit-plot"]')
  .getByRole("button", { name: "Save changes" })
  .click();
await o1.page.waitForURL(/error=/);
check(
  "plots: renaming onto an existing number is refused",
  (await flash(o1.page)).includes("already exists"),
);

// delete
await o1.page.goto(baseUrl + `${base}/plots`);
await o1.page.locator('input[name="plotId"][aria-label="Select plot D-3"]').check();
await o1.page.locator('[data-form="bulk"]').getByRole("button", { name: "Delete" }).click();
await o1.page.waitForURL(/saved=/);
check(
  "plots: deleting a ticked plot works",
  (await flash(o1.page)).includes("1 plot deleted") && (await counts(o1.page)).total === 25,
);
const history = await sql(`select count(*)::int as n from "PlotStatusLog" where "projectId" = $1`, [
  projectId,
]);
check(
  "plots: every status is logged, including for the deleted plot",
  history[0].n >= 26,
  String(history[0].n),
);

// =====================================================================
section("4. Approvals");
await o1.page.goto(baseUrl + `${base}/approvals`);
await o1.page.locator("#landUse").selectOption("Residential");
await o1.page.locator("#titleStatus").selectOption("Clear and marketable");
await o1.page.locator("#bankLoans").fill("SBI, HDFC, sbi");
await waitSaved(o1.page);
await o1.page.reload();
check(
  "approvals: land details and banks save",
  (await o1.page.locator("#bankLoans").inputValue()) === "SBI, HDFC",
);

const rera = o1.page.locator('[data-approval-kind="RERA"]');
await rera.locator("#RERA-number").fill("x");
await rera.getByRole("button", { name: "Save" }).click();
await o1.page.waitForURL(/error=/);
check(
  "approvals: a too-short number is refused",
  (await flash(o1.page)).includes("approval number"),
);
check(
  "approvals: you cannot attach a certificate before saving the number",
  (await o1.page.locator('[data-approval-kind="TNCP"] input[type="file"]').count()) === 0,
);

await o1.page.locator('[data-approval-kind="RERA"] #RERA-number').fill("TN/29/0123/2026");
await o1.page.locator('[data-approval-kind="RERA"] #RERA-till').fill("2031-01-01");
await o1.page.locator('[data-approval-kind="RERA"]').getByRole("button", { name: "Save" }).click();
await o1.page.waitForURL(/saved=RERA/);
check(
  "approvals: saving a RERA number works and awaits verification",
  (await o1.page.locator('[data-approval-kind="RERA"]').innerText()).includes(
    "Awaiting verification",
  ),
);
await o1.page
  .locator("#upload-APPROVAL-RERA")
  .setInputFiles({ name: "rera.pdf", mimeType: "application/pdf", buffer: PDF });
await o1.page
  .locator('[data-approval-kind="RERA"] a[href^="/api/project-documents/"]')
  .waitFor({ timeout: 15000 });
check(
  "approvals: the certificate attaches",
  (await o1.page
    .locator('[data-approval-kind="RERA"] a[href^="/api/project-documents/"]')
    .count()) === 1,
);
await o1.page
  .locator("#upload-APPROVAL-RERA")
  .setInputFiles({ name: "rera.pdf", mimeType: "application/pdf", buffer: FAKE });
await o1.page
  .getByText("Upload a PDF, JPG, PNG or WebP file.")
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check(
  "approvals: a fake PDF is refused",
  (await text(o1.page)).includes("Upload a PDF, JPG, PNG or WebP file."),
);

// =====================================================================
section("5. Timeline, pricing, amenities, contact");
await o1.page.goto(baseUrl + `${base}/timeline`);
await o1.page.locator("#startDate").fill("2025-01-15");
await o1.page.locator("#completionDate").fill("2024-01-01");
await o1.page.locator("#percentComplete").fill("40");
await waitSaved(o1.page);
await o1.page.goto(baseUrl + `${base}/review`);
check(
  "review: a completion date before the start date is flagged",
  (await text(o1.page)).includes("completion date is before the start date"),
);
await o1.page.goto(baseUrl + `${base}/timeline`);
await o1.page.locator("#completionDate").fill("2027-06-30");
await waitSaved(o1.page);

await o1.page.goto(baseUrl + `${base}/pricing`);
await o1.page.locator("#pricePerSqft").fill("₹1,850");
await o1.page.locator("#tokenAmount").fill("50000");
await o1.page.locator("#budgetFrom").fill("9000000");
await o1.page.locator("#budgetTo").fill("1000000");
await o1.page.locator("#paymentPlan").fill("10% on booking, balance at registration");
await waitSaved(o1.page);
await o1.page.reload();
check(
  "pricing: rupee symbols and commas are understood",
  (await o1.page.locator("#pricePerSqft").inputValue()) === "1850",
);
await o1.page.goto(baseUrl + `${base}/review`);
check(
  "review: a reversed price band is flagged",
  (await text(o1.page)).includes("starting price is higher than the highest price"),
);
await o1.page.goto(baseUrl + `${base}/pricing`);
await o1.page.locator("#budgetFrom").fill("");
await o1.page.locator("#budgetTo").fill("");
await waitSaved(o1.page);

await o1.page.goto(baseUrl + `${base}/amenities`);
for (const code of ["park", "gym", "street_lights"])
  await o1.page.locator(`input[name="amenities"][value="${code}"]`).check();
await waitSaved(o1.page);
await o1.page.reload();
check(
  "amenities: ticked boxes are remembered",
  (await o1.page.locator('input[name="amenities"]:checked').count()) === 3,
);
await o1.page.locator('input[name="amenities"][value="gym"]').uncheck();
await o1.page.locator('input[name="amenities"][value="street_lights"]').uncheck();
await o1.page.locator('input[name="amenities"][value="park"]').uncheck();
await waitSaved(o1.page);
await o1.page.reload();
check(
  "amenities: unticking every box is saved too",
  (await o1.page.locator('input[name="amenities"]:checked').count()) === 0,
);
for (const code of ["park", "gym", "security", "drainage"])
  await o1.page.locator(`input[name="amenities"][value="${code}"]`).check();
await waitSaved(o1.page);

await o1.page.goto(baseUrl + `${base}/contact`);
await o1.page.locator("#contactName").fill("Anand K");
await o1.page.locator("#contactMobile").fill("+91 98765 43210");
await o1.page.locator("#hideContactNumber").selectOption("hide");
await waitSaved(o1.page);
await o1.page.reload();
check(
  "contact: the mobile is normalised and the privacy choice kept",
  (await o1.page.locator("#contactMobile").inputValue()) === "9876543210" &&
    (await o1.page.locator("#hideContactNumber").inputValue()) === "hide",
);

// =====================================================================
section("6. Media");
await o1.page.goto(baseUrl + `${base}/media`);
await o1.page
  .locator("#upload-PHOTO")
  .setInputFiles({ name: "evil.jpg", mimeType: "image/jpeg", buffer: FAKE });
await o1.page
  .getByText("Upload a PDF, JPG, PNG or WebP file.")
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check(
  "media: a fake photo is refused",
  (await text(o1.page)).includes("Upload a PDF, JPG, PNG or WebP file.") &&
    (await o1.page.locator("[data-photo-id]").count()) === 0,
);
await o1.page
  .locator("#upload-PHOTO")
  .setInputFiles(
    [1, 2, 3].map((n) => ({ name: `photo${n}.png`, mimeType: "image/png", buffer: PNG })),
  );
await o1.page.waitForFunction(
  () => document.querySelectorAll("[data-photo-id]").length === 3,
  null,
  { timeout: 20000 },
);
check(
  "media: three photos upload at once",
  (await o1.page.locator("[data-photo-id]").count()) === 3,
);
check(
  "media: the first photo is the cover automatically",
  (await o1.page.locator('[data-photo-id][data-cover="true"]').count()) === 1,
);
const second = o1.page.locator("[data-photo-id]").nth(1);
await second.getByRole("button", { name: "Make cover" }).click();
await o1.page.waitForURL(/saved=cover/);
check(
  "media: another photo can be made the cover",
  (await o1.page.locator("[data-photo-id]").first().getAttribute("data-cover")) === "true",
);
await o1.page
  .locator("#upload-PHOTO")
  .setInputFiles({ name: "photo4.png", mimeType: "image/png", buffer: PNG });
await o1.page.waitForFunction(
  () => document.querySelectorAll("[data-photo-id]").length === 4,
  null,
  { timeout: 20000 },
);
await o1.page.locator("[data-photo-id]").first().getByRole("button", { name: "Remove" }).click();
await o1.page.waitForURL(/saved=removed/);
check(
  "media: removing the cover hands the cover to another photo",
  (await o1.page.locator("[data-photo-id]").count()) === 3 &&
    (await o1.page.locator('[data-photo-id][data-cover="true"]').count()) === 1,
);
await o1.page
  .locator("#upload-LAYOUT")
  .setInputFiles({ name: "layout.pdf", mimeType: "application/pdf", buffer: PDF });
await o1.page.locator('[data-section="layout"] a[href]').waitFor({ timeout: 15000 });
await o1.page
  .locator("#upload-BROCHURE")
  .setInputFiles({ name: "brochure.png", mimeType: "image/png", buffer: PNG });
await o1.page
  .getByText("The brochure must be a PDF.")
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check(
  "media: a brochure must be a PDF",
  (await text(o1.page)).includes("The brochure must be a PDF."),
);
await o1.page
  .locator("#upload-BROCHURE")
  .setInputFiles({ name: "brochure.pdf", mimeType: "application/pdf", buffer: PDF });
await o1.page.locator('[data-section="brochure"] a[href]').waitFor({ timeout: 15000 });
check(
  "media: layout plan and brochure attach",
  (await o1.page.locator('[data-section="layout"] a[href]').count()) === 1 &&
    (await o1.page.locator('[data-section="brochure"] a[href]').count()) === 1,
);
await o1.page.locator("#videoUrl").fill("https://vimeo.com/123");
await waitSaved(o1.page);
check(
  "media: a non-YouTube video link is refused",
  (await o1.page.locator("#videoUrl-error").count()) > 0,
);
await o1.page.locator("#videoUrl").fill("https://youtu.be/dQw4w9WgXcQ");
await waitSaved(o1.page);

// =====================================================================
section("7. Preview, and submitting");
await o1.page.goto(baseUrl + `${base}/preview`);
const preview = await text(o1.page);
check(
  "preview: shows the buyer's view of the project",
  preview.includes("Green Valley Enclave") &&
    preview.includes("Sulur, Coimbatore") &&
    preview.includes("A DTCP approved plotted layout"),
);
check(
  "preview: shows plots, approvals and amenities",
  preview.includes("B-5") && preview.includes("TN/29/0123/2026") && preview.includes("Park"),
);
check(
  "preview: hides the number when the builder chose to",
  preview.includes("Contact through RKB") && !preview.includes("9876543210"),
);
check(
  "preview: embeds the video privately",
  (await o1.page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/"]').count()) === 1,
);
check(
  "preview: says it is not visible to buyers yet",
  preview.includes("not visible to buyers yet"),
);

await o1.page.goto(baseUrl + `${base}/review`);
check(
  "review: nothing is mandatory, so there is no Required list",
  (await o1.page.locator('[data-testid="required-items"]').count()) === 0 &&
    (await text(o1.page)).includes("Nothing here is mandatory"),
);
check(
  "review: submit stays disabled until the company is verified",
  await o1.page.getByRole("button", { name: "Submit for review" }).isDisabled(),
);
check("review: and says why", (await text(o1.page)).includes("company must be verified"));

await sql(
  `update "Builder" set status = 'VERIFIED', "verifiedAt" = now(), "companyName" = 'Anand Realty' where id = (select "builderId" from "Project" where id = $1)`,
  [projectId],
);
await o1.page.reload();
check(
  "review: submit enables once the company is verified",
  await o1.page.getByRole("button", { name: "Submit for review" }).isEnabled(),
);
await o1.page.getByRole("button", { name: "Submit for review" }).click();
await o1.page.waitForURL(/saved=submitted/);
check("submit: the project is now under review", (await text(o1.page)).includes("Under review"));
let mails = await mailbox();
check(
  "mail: the admin was told about the project",
  mails.some((m) => /New project to review: Green Valley Enclave/.test(m.subject)),
);

section("8. Locked while under review");
await o1.page.goto(baseUrl + `${base}/basics`);
check("locked: fields are disabled", await o1.page.locator("#description").isDisabled());
const lockedUpload = await o1.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/upload`,
  { multipart: { kind: "PHOTO", file: { name: "x.png", mimeType: "image/png", buffer: PNG } } },
);
check(
  "locked: uploads are refused with 409",
  lockedUpload.status() === 409,
  String(lockedUpload.status()),
);
const lockedImport = await o1.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/plots/import`,
  {
    multipart: {
      mode: "confirm",
      file: {
        name: "p.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("plot_number,size_sqft\nZ-1,1000"),
      },
    },
  },
);
check(
  "locked: plot import is refused with 409",
  lockedImport.status() === 409,
  String(lockedImport.status()),
);
await o1.page.goto(baseUrl + `${base}/plots`);
check(
  "locked: the plot tools are hidden",
  (await o1.page.locator('[data-form="add-plot"]').count()) === 0 &&
    (await o1.page.locator('input[name="plotId"]').count()) === 0,
);

// =====================================================================
section("9. The admin reviews the project");
const adm = await open(people.admin);
await acceptTerms(adm.page, "/admin");
check(
  "admin: the overview counts the project",
  (await text(adm.page)).includes("1 project is waiting for review"),
);
await adm.page.goto(baseUrl + "/admin/projects");
await adm.page.getByRole("link", { name: "Green Valley Enclave" }).click();
await adm.page.waitForURL(/\/admin\/projects\/.+/);
const adminPath = here(adm.page);
check(
  "admin: opens the project and shows the buyer's view",
  (await text(adm.page)).includes("How buyers will see it") &&
    (await text(adm.page)).includes("B-5"),
);
check(
  "admin: Approve is available even though no approval is verified yet",
  await adm.page.getByRole("button", { name: "Approve and publish" }).isEnabled(),
);

const certHref = await adm.page
  .locator('a[href^="/api/project-documents/"]')
  .first()
  .getAttribute("href");
const cert = await adm.page.request.get(baseUrl + certHref);
check(
  "admin: can open the approval certificate",
  cert.status() === 200 && /pdf/.test(cert.headers()["content-type"] ?? ""),
  String(cert.status()),
);
check(
  "admin: the certificate cannot be cached or run",
  /no-store/.test(cert.headers()["cache-control"] ?? "") &&
    /sandbox/.test(cert.headers()["content-security-policy"] ?? ""),
);

const reraAdmin = adm.page.locator('[data-approval-kind="RERA"]');
await reraAdmin.getByRole("button", { name: "Send back" }).click();
await adm.page.waitForURL(/error=/);
check(
  "admin: sending back needs a note",
  (await flash(adm.page)).includes("at least 10 characters"),
);

await adm.page.locator("#decision-note").fill("short");
await adm.page.getByRole("button", { name: "Request changes" }).click();
await adm.page.waitForURL(/error=/);
check(
  "admin: a decision note must be long enough",
  (await flash(adm.page)).includes("at least 10 characters"),
);
await adm.page
  .locator("#decision-note")
  .fill("Please add the layout plan for phase two before we can approve.");
await adm.page.getByRole("button", { name: "Request changes" }).click();
await adm.page.waitForURL(/saved=Decision/);
check(
  "admin: status is now Changes requested",
  (await text(adm.page)).includes("Changes requested"),
);
mails = await mailbox();
const changesMail = mails.find((m) => /Changes needed on Green Valley Enclave/.test(m.subject));
check(
  "mail: the builder got the reviewer's note",
  !!changesMail &&
    /layout plan for phase two/.test(changesMail.text) &&
    changesMail.to.includes("owner1@test.example"),
);

// =====================================================================
section("10. The builder fixes it, resubmits, and the admin approves");
await o1.page.goto(baseUrl + `${base}/review`);
check(
  "builder: sees the reviewer's message",
  (await text(o1.page)).includes("layout plan for phase two"),
);
await o1.page.goto(baseUrl + `${base}/basics`);
check("builder: fields are editable again", await o1.page.locator("#description").isEnabled());
await o1.page
  .locator("#description")
  .fill(
    "A DTCP approved plotted layout close to the bypass, with tar roads, street lights, drainage, a park and a layout plan for phase two.",
  );
await waitSaved(o1.page);
await o1.page.goto(baseUrl + `${base}/review`);
await o1.page.getByRole("button", { name: "Submit for review" }).click();
await o1.page.waitForURL(/saved=submitted/);

await adm.page.goto(baseUrl + adminPath);
await adm.page
  .locator('[data-approval-kind="RERA"]')
  .getByRole("button", { name: "Verify" })
  .click();
await adm.page.waitForURL(/saved=/);
check(
  "admin: verifying the approval works",
  (await adm.page.locator('[data-approval-kind="RERA"]').innerText()).includes("Verified"),
);
check(
  "admin: Approve is now enabled",
  await adm.page.getByRole("button", { name: "Approve and publish" }).isEnabled(),
);

await adm.page.getByRole("button", { name: "Approve and publish" }).click();
await adm.page.waitForURL(/saved=Decision/);
const live = (
  await sql(`select status, slug, "publishedAt" from "Project" where id = $1`, [projectId])
)[0];
check(
  "admin: the project is live with its own address",
  live.status === "LIVE" && live.slug === "green-valley-enclave-coimbatore" && live.publishedAt,
  JSON.stringify(live),
);
mails = await mailbox();
check(
  "mail: the builder was told it is approved",
  mails.some(
    (m) =>
      /Green Valley Enclave is approved/.test(m.subject) && m.to.includes("owner1@test.example"),
  ),
);
await adm.page.goto(baseUrl + adminPath);
const historyText = await text(adm.page);
check(
  "admin: the history tells the whole story",
  [
    "project.created",
    "project.submit",
    "project.request_changes",
    "approval.verified",
    "project.approve",
    "approval_document.viewed",
  ].every((a) => historyText.includes(a)),
  historyText.slice(-300),
);

// =====================================================================
section("11. A live project: cosmetic edits yes, legal details no");
await o1.page.goto(baseUrl + `${base}/basics`);
check("live: the name is locked", await o1.page.locator("#name").isDisabled());
check(
  "live: the location is locked",
  (await o1.page.locator("#city").isDisabled()) &&
    (await o1.page.locator("#locality").isDisabled()),
);
check(
  "live: the description can still be improved",
  await o1.page.locator("#description").isEnabled(),
);
await o1.page
  .locator("#description")
  .fill(
    "A DTCP approved plotted layout close to the bypass. Now with a clubhouse planned for next year, plus tar roads, drainage and a park.",
  );
await waitSaved(o1.page);
await o1.page.goto(baseUrl + `${base}/approvals`);
check("live: legal details are locked", await o1.page.locator("#landUse").isDisabled());
check(
  "live: approval number fields are locked",
  await o1.page.locator('[data-approval-kind="RERA"] #RERA-number').isDisabled(),
);
const liveApproval = await o1.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/upload`,
  {
    multipart: {
      kind: "APPROVAL",
      approval: "RERA",
      file: { name: "r.pdf", mimeType: "application/pdf", buffer: PDF },
    },
  },
);
check(
  "live: swapping an approval certificate is refused",
  liveApproval.status() === 409,
  String(liveApproval.status()),
);
const livePhoto = await o1.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/upload`,
  { multipart: { kind: "PHOTO", file: { name: "n.png", mimeType: "image/png", buffer: PNG } } },
);
check("live: adding a photo is allowed", livePhoto.status() === 200, String(livePhoto.status()));

await o1.page.goto(baseUrl + `${base}/plots`);
await o1.page.locator('[data-plot-number="B-9"] select').selectOption("SOLD");
await o1.page.waitForTimeout(1500);
c = await counts(o1.page);
check("live: plot statuses can still be changed", c.sold === 3, JSON.stringify(c));

await o1.page.goto(baseUrl + `${base}/review`);
await o1.page.getByRole("button", { name: "Edit and resubmit" }).click();
await o1.page.waitForURL(/saved=reopened/);
check(
  "live: 'Edit and resubmit' takes it offline",
  (await sql(`select status from "Project" where id = $1`, [projectId]))[0].status ===
    "CHANGES_REQUESTED",
);
await o1.page.goto(baseUrl + `${base}/basics`);
check("live: after reopening, the name is editable", await o1.page.locator("#name").isEnabled());

// =====================================================================
section("12. Plan limit and archiving");
await o1.page.goto(baseUrl + "/portal/projects");
for (let i = 2; i <= 6; i++) {
  await o1.page.locator("#name").fill(`Extra Project ${i}`);
  await o1.page.getByRole("button", { name: "Create" }).click();
  await o1.page.waitForURL(/\/basics$/);
  await o1.page.goto(baseUrl + "/portal/projects");
}
check("limit: six projects fit the plan", (await o1.page.locator("ul.grid > li").count()) === 6);
check(
  "limit: the seventh is blocked, with a reason",
  (await o1.page.locator("#name").isDisabled()) &&
    (await text(o1.page)).includes("reached your plan"),
);
await o1.page.evaluate(() =>
  document.querySelectorAll("form input, form select, form button").forEach((el) => {
    el.disabled = false;
  }),
);
await o1.page.locator("#name").fill("Sneaky Seventh");
await o1.page.getByRole("button", { name: "Create" }).click();
await o1.page.waitForURL(/error=/);
check(
  "limit: the server enforces it too, not just the form",
  (await flash(o1.page)).includes("Your plan allows 6 projects"),
  await flash(o1.page),
);
check(
  "limit: and the seventh project was not created",
  (await sql(`select count(*)::int as n from "Project" where name = 'Sneaky Seventh'`))[0].n === 0,
);
await o1.page.goto(baseUrl + "/portal/projects");
await o1.page.getByRole("link", { name: "Extra Project 6" }).click();
await o1.page.waitForURL(/\/basics$/);
await o1.page.goto(baseUrl + here(o1.page).replace("/basics", "/review"));
await o1.page.getByRole("button", { name: "Archive this project" }).click();
await o1.page.waitForURL(/\/portal\/projects$/);
check(
  "archive: an archived project frees up a place in the plan",
  await o1.page.locator("#name").isEnabled(),
);

// =====================================================================
section("13. Privacy and access");
const own2 = await open(people.owner2);
await acceptTerms(own2.page, "/start-listing");
await own2.page.getByRole("button", { name: "Create my builder account" }).click();
await own2.page.waitForURL(/\/portal$/);
for (const [label, p] of [
  ["wizard", `${base}/basics`],
  ["plots", `${base}/plots`],
  ["preview", `${base}/preview`],
]) {
  const response = await own2.page.goto(baseUrl + p);
  check(
    `privacy: another builder cannot open this project's ${label}`,
    response?.status() === 404,
    String(response?.status()),
  );
}
const otherUpload = await own2.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/upload`,
  { multipart: { kind: "PHOTO", file: { name: "x.png", mimeType: "image/png", buffer: PNG } } },
);
check("privacy: nor upload into it", otherUpload.status() === 404, String(otherUpload.status()));
const otherImport = await own2.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/plots/import`,
  {
    multipart: {
      mode: "confirm",
      file: {
        name: "p.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("plot_number,size_sqft\nZ-1,1000"),
      },
    },
  },
);
check(
  "privacy: nor import plots into it",
  otherImport.status() === 404,
  String(otherImport.status()),
);
const approvalId = (
  await sql(`select id from "ProjectApproval" where "projectId" = $1 and kind = 'RERA'`, [
    projectId,
  ])
)[0].id;
const otherCert = await own2.page.request.get(baseUrl + `/api/project-documents/${approvalId}`);
check(
  "privacy: nor read its approval certificate",
  otherCert.status() === 404,
  String(otherCert.status()),
);
check(
  "privacy: nothing was written into the project",
  (
    await sql(`select count(*)::int as n from "Plot" where "projectId" = $1 and number = 'Z-1'`, [
      projectId,
    ])
  )[0].n === 0,
);

const buy = await open(people.buyer);
await acceptTerms(buy.page, "/account");
await buy.page.goto(baseUrl + "/portal/projects");
check(
  "privacy: a buyer is sent away from the builder area",
  here(buy.page) === "/account",
  here(buy.page),
);
const buyerUpload = await buy.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/upload`,
  { multipart: { kind: "PHOTO", file: { name: "x.png", mimeType: "image/png", buffer: PNG } } },
);
check("privacy: a buyer cannot upload", buyerUpload.status() === 404, String(buyerUpload.status()));
const anon = await open(null);
const anonImport = await anon.page.request.post(
  baseUrl + `/api/builder/projects/${projectId}/plots/import`,
  {
    multipart: {
      mode: "preview",
      file: { name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("x") },
    },
  },
);
check(
  "privacy: a logged-out visitor gets 401",
  anonImport.status() === 401,
  String(anonImport.status()),
);
const adminOnly = await own2.page.goto(baseUrl + "/admin/projects");
check(
  "privacy: a builder cannot open the admin project queue",
  here(own2.page) === "/portal",
  here(own2.page),
);
void adminOnly;

const photoSrc = await sql(
  `select "storageKey" from "ProjectMedia" where "projectId" = $1 and kind = 'PHOTO' limit 1`,
  [projectId],
);
const photo = await anon.page.request.get(baseUrl + `/api/files/${photoSrc[0].storageKey}`);
check(
  "privacy: project photos are public",
  photo.status() === 200 && /image\/png/.test(photo.headers()["content-type"] ?? ""),
  String(photo.status()),
);
const certKey = (
  await sql(`select "storageKey" from "ProjectApproval" where id = $1`, [approvalId])
)[0].storageKey;
const leaked = await anon.page.request.get(baseUrl + `/api/files/${certKey}`);
check(
  "privacy: approval certificates are NOT reachable through the public route",
  leaked.status() === 404,
  String(leaked.status()),
);

// =====================================================================
section("14. Every page and link works");
async function crawl(page, label, starts) {
  const seen = new Map();
  for (const start of starts) {
    await page.goto(baseUrl + start);
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    for (const href of hrefs) {
      const clean = href.split("#")[0];
      // /auth/ and /logout end the session, which would break every page checked after them
      if (!clean || clean.startsWith("/auth/") || clean === "/logout" || seen.has(clean)) continue;
      const response = await page.request.get(baseUrl + clean, { maxRedirects: 5 });
      seen.set(clean, response.status());
    }
  }
  const broken = [...seen].filter(([, status]) => status >= 400);
  check(
    `${label}: ${seen.size} links checked, none broken`,
    broken.length === 0,
    JSON.stringify(broken),
  );
}
const steps = [
  "basics",
  "layout",
  "plots",
  "approvals",
  "timeline",
  "pricing",
  "amenities",
  "media",
  "contact",
  "review",
  "preview",
];
for (const step of steps) {
  const response = await o1.page.goto(baseUrl + `${base}/${step}`);
  check(`wizard: the ${step} step opens`, response?.status() === 200, String(response?.status()));
}
await crawl(o1.page, "builder portal", [
  "/portal",
  "/portal/projects",
  ...steps.map((s) => `${base}/${s}`),
]);
await crawl(adm.page, "admin console", [
  "/admin",
  "/admin/builders",
  "/admin/projects",
  "/admin/projects?status=LIVE",
  adminPath,
]);

// the wizard on a phone
const phone = await open(people.owner1, { width: 390, height: 844 });
await phone.page.goto(baseUrl + `${base}/plots`);
check("phone: the wizard shows 'Step 3 of 10'", (await text(phone.page)).includes("Step 3 of 10"));
const overflow = await phone.page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 2,
);
check("phone: the plots step does not scroll sideways as a page", !overflow);

// =====================================================================
section("15. A barely filled-in project can be submitted, approved and shown to buyers");
await sql(
  `update "Builder" set status = 'VERIFIED', "verifiedAt" = now(), "companyName" = 'Second Builders'
   where id = (select bm."builderId" from "BuilderMember" bm join "User" u on u.id = bm."userId" where u.email = 'owner2@test.example')`,
);
await sql(
  `insert into "Subscription"(id,"builderId",plan,source,"currentPeriodStart","currentPeriodEnd","updatedAt")
   select gen_random_uuid()::text, bm."builderId", 'GROWTH', 'COMP', now(), now() + interval '60 days', now()
   from "BuilderMember" bm join "User" u on u.id = bm."userId" where u.email = 'owner2@test.example'`,
);
await own2.page.goto(baseUrl + "/portal/projects");
await own2.page.locator("#name").fill("Bare Minimum Layout");
await own2.page.getByRole("button", { name: "Create" }).click();
await own2.page.waitForURL(/\/portal\/projects\/[^/]+\/basics$/);
const bareId = here(own2.page).split("/")[3];
await own2.page.goto(baseUrl + `/portal/projects/${bareId}/basics`);
check(
  "wizard: no field except the name is marked as required",
  (await own2.page.locator("label span[aria-hidden='true']", { hasText: "*" }).count()) === 1,
);
await own2.page.goto(baseUrl + `/portal/projects/${bareId}/review`);
check(
  "review: a nearly empty project can be submitted",
  await own2.page.getByRole("button", { name: "Submit for review" }).isEnabled(),
);
check(
  "review: it is explained as optional",
  (await text(own2.page)).includes("Nothing here is mandatory"),
);
await own2.page.getByRole("button", { name: "Submit for review" }).click();
await own2.page.waitForURL(/saved=submitted/);
check("submit: it goes to review", (await text(own2.page)).includes("Under review"));

await adm.page.goto(baseUrl + "/admin/projects");
await adm.page.getByRole("link", { name: "Bare Minimum Layout" }).click();
await adm.page.waitForURL(/\/admin\/projects\/.+/);
check(
  "admin: sees that nothing has been added, without an error",
  (await text(adm.page)).includes("has not added any approvals"),
);
check(
  "admin: can approve it although it is far from complete",
  await adm.page.getByRole("button", { name: "Approve and publish" }).isEnabled(),
);
await adm.page.getByRole("button", { name: "Approve and publish" }).click();
await adm.page.waitForURL(/saved=Decision/);
const bare = (await sql(`select status, slug from "Project" where id = $1`, [bareId]))[0];
check(
  "admin: the bare project is live with an address",
  bare.status === "LIVE" && !!bare.slug,
  JSON.stringify(bare),
);

const barePage = await fetch(baseUrl + `/project/${bare.slug}`);
const bareHtml = await barePage.text();
check("public: its page loads", barePage.status === 200, String(barePage.status));
check(
  "public: the page shows the name and says plainly what is not listed",
  bareHtml.includes("Bare Minimum Layout") &&
    bareHtml.includes("has not listed any approvals yet") &&
    bareHtml.includes("takes enquiries through RKB"),
);
const listPage = await fetch(baseUrl + "/projects?q=Bare+Minimum");
const listHtml = await listPage.text();
check(
  "public: it appears in search with 'Price on request' and no empty-looking gaps",
  listHtml.includes("Bare Minimum Layout") && listHtml.includes("Price on request"),
);
const phoneView = await open(null, { width: 390, height: 844 });
await phoneView.page.goto(baseUrl + `/project/${bare.slug}`);
check(
  "public: the bare page fits a phone screen",
  !(await phoneView.page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  )),
);

await db.end();
await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
