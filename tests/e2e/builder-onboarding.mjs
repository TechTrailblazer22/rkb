// End-to-end check of builder onboarding and admin verification, in a real browser, against a
// real Postgres, with local file storage and the dev mail outbox. See docs/TESTING.md.
//
//   node tests/e2e/builder-onboarding.mjs <projectDir> <baseUrl> <AUTH0_SECRET> <mailOutboxDir>
//
// The server must run with STORAGE_DRIVER=local, MAIL_DRIVER=file and MAIL_OUTBOX_DIR set to
// the same folder, ADMIN_EMAILS=admin@test.example, and an EMPTY database.
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const [, , projectDir, baseUrl, secret, outboxDir] = process.argv;
const require = createRequire(path.join(projectDir, "package.json"));
const { chromium } = require("@playwright/test");
const { generateSessionCookie } = require("@auth0/nextjs-auth0/testing");

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
const FAKE_PDF = Buffer.from("<html><script>alert('owned')</script></html>");

const people = {
  owner1: {
    sub: "auth0|owner1",
    email: "owner1@test.example",
    email_verified: true,
    name: "Anand Owner",
  },
  owner2: {
    sub: "auth0|owner2",
    email: "owner2@test.example",
    email_verified: true,
    name: "Second Owner",
  },
  owner3: {
    sub: "auth0|owner3",
    email: "owner3@test.example",
    email_verified: true,
    name: "Blank Owner",
  },
  buyer: {
    sub: "auth0|buyer",
    email: "buyer@test.example",
    email_verified: true,
    name: "Bina Buyer",
  },
  admin: {
    sub: "auth0|admin",
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

const browser = await chromium.launch({ channel: "msedge" });
async function open(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (user) await context.addCookies([await cookieFor(user)]);
  const page = await context.newPage();
  return { context, page };
}
const here = (page) => new URL(page.url()).pathname;
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
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});

async function acceptTerms(page, startAt) {
  await page.goto(baseUrl + startAt);
  if (here(page) === "/welcome") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForLoadState("networkidle");
  }
}

async function waitSaved(page) {
  await page.waitForTimeout(1200); // longer than the autosave debounce
  await page.waitForFunction(() => document.body.innerText.includes("All changes saved"), null, {
    timeout: 15000,
  });
}

// =====================================================================
section("1. A new builder signs up");
const o1 = await open(people.owner1);
await acceptTerms(o1.page, "/start-listing");
await o1.page.getByRole("button", { name: "Create my builder account" }).click();
await o1.page.waitForURL(/\/portal$/);
check("owner: lands on /portal", here(o1.page) === "/portal");
check(
  "owner: progress starts at 0%",
  (await o1.page.getByRole("progressbar").first().getAttribute("aria-valuenow")) === "0",
);
check(
  "owner: shows the four-step checklist",
  (await o1.page.getByText("Verification documents").count()) > 0,
);

// =====================================================================
section("2. Company profile autosaves");
await o1.page.goto(baseUrl + "/portal/profile");
await o1.page.locator("#companyName").fill("Anand Realty");
await o1.page.locator("#type").selectOption("PRIVATE_LIMITED");
await o1.page.locator("#yearEstablished").fill("2010");
await o1.page.locator("#contactPerson").fill("Anand K");
await o1.page.locator("#contactMobile").fill("+91 98765 43210");
await o1.page.locator("#addressLine").fill("12 Race Course Road");
await o1.page.locator("#city").fill("Coimbatore");
await o1.page.locator("#state").selectOption("Tamil Nadu");
await o1.page.locator("#pincode").fill("641018");
await o1.page.locator("#pan").fill("NOT-A-PAN");
await o1.page.locator("#gstin").fill("27AAPFU0939F1ZV");
await waitSaved(o1.page);
check("profile: a bad PAN shows a message", (await o1.page.locator("#pan-error").count()) > 0);

await o1.page.reload();
check(
  "profile: valid fields survive a reload",
  (await o1.page.locator("#companyName").inputValue()) === "Anand Realty",
);
check(
  "profile: the mobile was normalised",
  (await o1.page.locator("#contactMobile").inputValue()) === "9876543210",
);
check("profile: the bad PAN was NOT saved", (await o1.page.locator("#pan").inputValue()) === "");

await o1.page.locator("#pan").fill("aapfu 0939 f");
await waitSaved(o1.page);
check(
  "profile: the PAN error clears once fixed",
  (await o1.page.locator("#pan-error").count()) === 0,
);
await o1.page.reload();
check(
  "profile: PAN saved in capitals without spaces",
  (await o1.page.locator("#pan").inputValue()) === "AAPFU0939F",
);

// =====================================================================
section("3. Cannot submit yet");
await o1.page.goto(baseUrl + "/portal/review");
check(
  "review: Submit is disabled until a plan is chosen (the only thing still required)",
  await o1.page.getByRole("button", { name: "Submit for verification" }).isDisabled(),
);

// =====================================================================
section("4. Documents");
await o1.page.goto(baseUrl + "/portal/documents");
await o1.page
  .locator("#file-RERA")
  .setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: FAKE_PDF });
await o1.page
  .getByText("Upload a PDF, JPG, PNG or WebP file.")
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check(
  "documents: an HTML file renamed .pdf is refused",
  (await o1.page.getByText("Upload a PDF, JPG, PNG or WebP file.").count()) > 0,
);

for (const kind of ["PAN", "GST", "BUSINESS_PROOF", "IDENTITY_PROOF", "ADDRESS_PROOF"]) {
  await o1.page
    .locator(`#file-${kind}`)
    .setInputFiles({ name: `${kind}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await o1.page
    .locator(`[data-document-kind="${kind}"] a[href^="/api/documents/"]`)
    .waitFor({ timeout: 15000 });
}
check(
  "documents: all five files uploaded",
  (await o1.page.locator('a[href^="/api/documents/"]').count()) === 5,
);
check(
  "documents: nothing stored for the refused file",
  (await o1.page.locator('[data-document-kind="RERA"] a[href^="/api/documents/"]').count()) === 0,
);

// =====================================================================
section("5. Plan and submit");
await o1.page.goto(baseUrl + "/portal/plan");
await o1.page.locator('input[name="plan"][value="GROWTH"]').check({ force: true });
await o1.page.getByRole("button", { name: "Save and continue" }).click();
await o1.page.waitForURL(/\/portal\/review/);
check("plan: choosing a plan leads to the review step", here(o1.page) === "/portal/review");
check(
  "review: Submit is now enabled",
  await o1.page.getByRole("button", { name: "Submit for verification" }).isEnabled(),
);
await o1.page.getByRole("button", { name: "Submit for verification" }).click();
await o1.page.waitForURL(/\/portal$/);
await settle(o1.page);
check(
  "submit: overview says under review",
  (await o1.page.getByText("Your application is under review").count()) > 0,
);

let mails = await mailbox();
check(
  "mail: the builder got a confirmation",
  mails.some((m) => m.to === "owner1@test.example" && /received/i.test(m.subject)),
);
check(
  "mail: the admin was notified",
  mails.some(
    (m) => JSON.stringify(m.to).includes("admin@test.example") && /Anand Realty/.test(m.subject),
  ),
);

// =====================================================================
section("6. Locked while under review");
await o1.page.goto(baseUrl + "/portal/profile");
check("locked: profile fields are disabled", await o1.page.locator("#companyName").isDisabled());
const lockedUpload = await o1.page.request.post(baseUrl + "/api/builder/upload", {
  multipart: { kind: "PAN", file: { name: "x.pdf", mimeType: "application/pdf", buffer: PDF } },
});
check(
  "locked: uploading is refused with 409",
  lockedUpload.status() === 409,
  String(lockedUpload.status()),
);
await o1.page.goto(baseUrl + "/portal/review");
check(
  "locked: the review step offers no Submit button",
  (await o1.page.getByRole("button", { name: "Submit for verification" }).count()) === 0,
);

// =====================================================================
section("7. The admin reviews");
const adm = await open(people.admin);
await acceptTerms(adm.page, "/admin");
check(
  "admin: sees one application waiting",
  (await adm.page.getByText("application is").count()) > 0,
);
await adm.page.goto(baseUrl + "/admin/builders?status=SUBMITTED");
await adm.page.getByRole("link", { name: "Anand Realty" }).click();
await adm.page.waitForURL(/\/admin\/builders\/.+/);
const builderPath = here(adm.page);
check("admin: opens the application", (await adm.page.getByText("Company details").count()) > 0);
check(
  "admin: Approve builder is disabled until documents are approved",
  await adm.page.getByRole("button", { name: "Approve builder" }).isDisabled(),
);

const firstDocHref = await adm.page
  .locator('a[href^="/api/documents/"]')
  .first()
  .getAttribute("href");
const viewed = await adm.page.request.get(baseUrl + firstDocHref);
check(
  "admin: can open a private document",
  viewed.status() === 200 && /pdf/.test(viewed.headers()["content-type"] ?? ""),
  String(viewed.status()),
);
check(
  "admin: the document is served without being cacheable",
  /no-store/.test(viewed.headers()["cache-control"] ?? ""),
);
check(
  "admin: the document cannot run scripts",
  /sandbox/.test(viewed.headers()["content-security-policy"] ?? ""),
);

// send back PAN with a too-short note
const panBlock = adm.page.locator('[data-document-kind="PAN"]');
await panBlock.locator('input[name="note"]').fill("blurry");
await panBlock.getByRole("button", { name: "Send back" }).click();
await adm.page.waitForURL(/error=/);
check(
  "admin: a one-word note is refused",
  (await adm.page
    .getByRole("alert")
    .getByText(/at least 10 characters/)
    .count()) > 0,
);

await adm.page
  .locator('[data-document-kind="PAN"] input[name="note"]')
  .fill("The PAN image is blurry. Please upload a clearer scan.");
await adm.page
  .locator('[data-document-kind="PAN"]')
  .getByRole("button", { name: "Send back" })
  .click();
await adm.page.waitForURL(/saved=/);
check(
  "admin: sent the PAN document back",
  (await adm.page.getByText("Document sent back.").count()) > 0,
);

for (const kind of ["GST", "BUSINESS_PROOF", "IDENTITY_PROOF", "ADDRESS_PROOF"]) {
  await adm.page
    .locator(`[data-document-kind="${kind}"]`)
    .getByRole("button", { name: "Approve" })
    .click();
  await adm.page.waitForURL(/saved=/);
}
check(
  "admin: still cannot approve with the PAN document rejected",
  await adm.page.getByRole("button", { name: "Approve builder" }).isDisabled(),
);

await adm.page.locator("#decision-note").fill("short");
await adm.page.getByRole("button", { name: "Request changes" }).click();
await adm.page.waitForURL(/error=/);
check(
  "admin: a decision note must be long enough",
  (await adm.page
    .getByRole("alert")
    .getByText(/at least 10 characters/)
    .count()) > 0,
);

await adm.page
  .locator("#decision-note")
  .fill("Please replace the PAN scan. Everything else looks good.");
await adm.page.getByRole("button", { name: "Request changes" }).click();
await adm.page.waitForURL(/saved=Decision/);
check(
  "admin: status is now Changes requested",
  (await adm.page.getByText("Changes requested").count()) > 0,
);
mails = await mailbox();
const changesMail = mails.find((m) => /Action needed/.test(m.subject));
check(
  "mail: the builder was told what to change",
  !!changesMail &&
    /replace the PAN scan/.test(changesMail.text) &&
    changesMail.to.includes("owner1@test.example"),
);

// =====================================================================
section("8. The builder fixes it and resubmits");
await o1.page.goto(baseUrl + "/portal");
check(
  "builder: sees the reviewer's message",
  (await o1.page.getByText("Please replace the PAN scan").count()) > 0,
);
check(
  "builder: sees the note on the flagged document",
  (await o1.page.getByText("The PAN image is blurry").count()) > 0,
);
await o1.page.goto(baseUrl + "/portal/review");
check(
  "builder: cannot resubmit until the document is replaced",
  await o1.page.getByRole("button", { name: "Submit for verification" }).isDisabled(),
);

await o1.page.goto(baseUrl + "/portal/documents");
const oldPanHref = await o1.page
  .locator('[data-document-kind="PAN"] a[href^="/api/documents/"]')
  .getAttribute("href");
await o1.page
  .locator("#file-PAN")
  .setInputFiles({ name: "PAN-clear.png", mimeType: "image/png", buffer: PNG });
await o1.page.getByText("PAN-clear.png").waitFor({ timeout: 15000 });
check("builder: replaced the PAN document", (await o1.page.getByText("PAN-clear.png").count()) > 0);
check(
  "builder: the replacement is awaiting review again",
  (await o1.page.locator('[data-document-kind="PAN"]').getByText("Awaiting review").count()) > 0,
);
check(
  "builder: still one PAN document, not two",
  oldPanHref ===
    (await o1.page
      .locator('[data-document-kind="PAN"] a[href^="/api/documents/"]')
      .getAttribute("href")),
);

await o1.page.goto(baseUrl + "/portal/profile");
await o1.page.locator("#about").fill("We build approved plotted layouts across Tamil Nadu.");
await waitSaved(o1.page);
await o1.page.goto(baseUrl + "/portal/review");
await o1.page.getByRole("button", { name: "Submit for verification" }).click();
await o1.page.waitForURL(/\/portal$/);
await settle(o1.page);
check(
  "builder: resubmitted, back under review",
  (await o1.page.getByText("Your application is under review").count()) > 0,
);

// =====================================================================
section("9. The admin approves");
await adm.page.goto(baseUrl + builderPath);
check("admin: sees the resubmission", (await adm.page.getByText("Under review").count()) > 0);
await adm.page
  .locator('[data-document-kind="PAN"]')
  .getByRole("button", { name: "Approve" })
  .click();
await adm.page.waitForURL(/saved=/);
check(
  "admin: Approve builder is now enabled",
  await adm.page.getByRole("button", { name: "Approve builder" }).isEnabled(),
);
await adm.page.getByRole("button", { name: "Approve builder" }).click();
await adm.page.waitForURL(/saved=Decision/);
check(
  "admin: builder is Verified",
  (await adm.page.getByText("Verified", { exact: true }).count()) > 0,
);
check(
  "admin: history records the whole story",
  (await adm.page.getByText("builder.approve").count()) > 0 &&
    (await adm.page.getByText("document.viewed").count()) > 0 &&
    (await adm.page.getByText("builder.submitted").count()) >= 2,
);
mails = await mailbox();
check(
  "mail: the builder was told they are verified",
  mails.some((m) => /Verified Builder/.test(m.subject) && m.to.includes("owner1@test.example")),
);

// =====================================================================
section("10. A verified builder");
await o1.page.goto(baseUrl + "/portal");
check(
  "verified: overview congratulates them",
  (await o1.page.getByText("You are a Verified Builder").count()) > 0,
);
await o1.page.goto(baseUrl + "/portal/profile");
check(
  "verified: legal identity is locked",
  (await o1.page.locator("#pan").isDisabled()) &&
    (await o1.page.locator("#companyName").isDisabled()),
);
check("verified: presentation fields stay editable", await o1.page.locator("#about").isEnabled());
await o1.page.locator("#website").fill("www.anandrealty.in");
await waitSaved(o1.page);
await o1.page.reload();
check(
  "verified: a presentation edit saves",
  (await o1.page.locator("#website").inputValue()) === "https://www.anandrealty.in",
);

// forging a request for a locked field must be refused by the server, not just the UI
const forged = await o1.page.evaluate(async () => {
  const response = await fetch("/api/builder/upload", { method: "POST", body: new FormData() });
  return response.status;
});
check(
  "verified: malformed upload requests are rejected",
  forged === 400 || forged === 415,
  String(forged),
);

await o1.page.goto(baseUrl + "/portal/profile");
await o1.page
  .locator("#upload-LOGO")
  .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
await o1.page.waitForSelector('img[alt="Logo preview"]', { timeout: 15000 });
const logoSrc = await o1.page.locator('img[alt="Logo preview"]').getAttribute("src");
const logo = await o1.page.request.get(baseUrl + logoSrc);
check(
  "branding: the logo uploads and is publicly viewable",
  logo.status() === 200 && /image\/png/.test(logo.headers()["content-type"] ?? ""),
  `${logo.status()} ${logoSrc}`,
);
const docKey = oldPanHref.split("/").pop();
const sneaky = await o1.page.request.get(baseUrl + `/api/files/builders/x/docs/${docKey}`);
check(
  "branding: private document paths are not served by the public route",
  sneaky.status() === 404,
  String(sneaky.status()),
);

// =====================================================================
section("11. Privacy: nobody else can see these documents");
const panDocHref = oldPanHref;
const own2 = await open(people.owner2);
await acceptTerms(own2.page, "/start-listing");
await own2.page.getByRole("button", { name: "Create my builder account" }).click();
await own2.page.waitForURL(/\/portal$/);
const other = await own2.page.request.get(baseUrl + panDocHref);
check(
  "privacy: another builder gets 404 for someone else's document",
  other.status() === 404,
  String(other.status()),
);

const buy = await open(people.buyer);
await acceptTerms(buy.page, "/account");
const asBuyer = await buy.page.request.get(baseUrl + panDocHref);
check("privacy: a buyer gets 404 as well", asBuyer.status() === 404, String(asBuyer.status()));
const buyerUpload = await buy.page.request.post(baseUrl + "/api/builder/upload", {
  multipart: { kind: "PAN", file: { name: "x.pdf", mimeType: "application/pdf", buffer: PDF } },
});
check("privacy: a buyer cannot upload", buyerUpload.status() === 403, String(buyerUpload.status()));

const anon = await open(null);
const asAnon = await anon.page.request.get(baseUrl + panDocHref);
check("privacy: a logged-out visitor gets 401", asAnon.status() === 401, String(asAnon.status()));

// =====================================================================
section("12. Duplicate detection");
await own2.page.goto(baseUrl + "/portal/profile");
await own2.page.locator("#companyName").fill("Copycat Estates");
await own2.page.locator("#pan").fill("AAPFU0939F");
await waitSaved(own2.page);
await adm.page.goto(baseUrl + "/admin/builders?status=DRAFT");
await adm.page.getByRole("link", { name: "Copycat Estates" }).click();
await adm.page.waitForURL(/\/admin\/builders\/.+/);
check(
  "admin: warned that the PAN is already used by another company",
  (await adm.page.getByText("Possible duplicate").count()) > 0 &&
    (await adm.page.getByRole("link", { name: "Anand Realty" }).count()) > 0,
);

// =====================================================================
section("13. Files on disk");
async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else found.push(full);
  }
  return found;
}
const stored = await filesUnder(path.join(outboxDir, "storage"));
const privateDocs = stored.filter((f) => f.split(path.sep).join("/").includes("/docs/"));
check(
  "storage: exactly the five current documents exist, so the replaced PAN file was deleted",
  privateDocs.length === 5,
  `found ${privateDocs.length}`,
);
let sawScript = false;
for (const file of stored)
  if ((await readFile(file)).toString("latin1").includes("<script>")) sawScript = true;
check("storage: the refused HTML upload left nothing behind", !sawScript);

// =====================================================================
section("14. Admin list and access control");
await adm.page.goto(baseUrl + "/admin/builders?status=VERIFIED");
check(
  "admin: the verified list shows the company",
  (await adm.page.getByRole("link", { name: "Anand Realty" }).count()) > 0,
);
await o1.page.goto(baseUrl + "/admin/builders");
check(
  "access: a builder cannot open the admin console",
  here(o1.page) === "/portal",
  here(o1.page),
);

// =====================================================================
section("15. Nothing in the company profile or documents is mandatory");
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const own3 = await open(people.owner3);
await acceptTerms(own3.page, "/start-listing");
await own3.page.getByRole("button", { name: "Create my builder account" }).click();
await own3.page.waitForURL(/\/portal$/);
await own3.page.goto(baseUrl + "/portal/profile");
check(
  "profile: no field is marked as required",
  (await own3.page.locator("label span[aria-hidden='true']", { hasText: "*" }).count()) === 0,
);
await own3.page.goto(baseUrl + "/portal/documents");
check(
  "documents: every document is marked optional and none is starred",
  (await own3.page.getByText("Optional", { exact: true }).count()) === 7 &&
    (await own3.page.locator("h3 span[aria-hidden='true']", { hasText: "*" }).count()) === 0,
);
await own3.page.goto(baseUrl + "/portal/plan");
await own3.page.locator('input[name="plan"][value="STARTER"]').check({ force: true });
await own3.page.getByRole("button", { name: "Save and continue" }).click();
await own3.page.waitForURL(/\/portal\/review/);
check(
  "review: an empty profile and no documents can be submitted",
  await own3.page.getByRole("button", { name: "Submit for verification" }).isEnabled(),
);
check(
  "review: says the details are optional rather than listing them as needed",
  (await text(own3.page)).includes("All are optional") &&
    !(await text(own3.page)).includes("still needed"),
);
await own3.page.getByRole("button", { name: "Submit for verification" }).click();
await own3.page.waitForURL(/\/portal$/);
check(
  "submit: the blank application is with the team",
  (await text(own3.page)).includes("with our team") ||
    (await text(own3.page)).includes("under review"),
);
await adm.page.goto(baseUrl + "/admin/builders?status=SUBMITTED");
await adm.page.getByRole("link", { name: "(no name yet)" }).first().click();
await adm.page.waitForURL(/\/admin\/builders\/.+/);
check(
  "admin: opens a blank application without errors",
  (await adm.page.getByText("Company details").count()) > 0,
);
check(
  "admin: with nothing uploaded, nothing blocks approval",
  await adm.page.getByRole("button", { name: "Approve builder" }).isEnabled(),
);
await adm.page.getByRole("button", { name: "Approve builder" }).click();
await adm.page.waitForURL(/saved=Decision/);
check(
  "admin: a nameless builder can be approved",
  (await adm.page.getByText("Verified", { exact: true }).count()) > 0,
);

await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
