// End-to-end check of every logged-in flow. Not part of `npm test`: it needs a running server and a
// disposable Postgres. Usage (see docs/TESTING.md):
//   node tests/e2e/logged-in-flows.mjs <projectDir> <baseUrl> <AUTH0_SECRET used by the server>
import { createRequire } from "node:module";
import path from "node:path";

const [, , projectDir, baseUrl, secret] = process.argv;
const require = createRequire(path.join(projectDir, "package.json"));
const { chromium } = require("@playwright/test");
const { generateSessionCookie } = require("@auth0/nextjs-auth0/testing");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
};

async function sessionCookie(user) {
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
async function newPage(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (user) await context.addCookies([await sessionCookie(user)]);
  return { context, page: await context.newPage() };
}
const pathOf = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

// ---------- 1. Anonymous visitor ----------
{
  const { context, page } = await newPage(null);
  await page.goto(baseUrl + "/");
  await page.waitForResponse((r) => r.url().includes("/api/me")).catch(() => {});
  await page.waitForTimeout(600);
  check(
    "anonymous: header shows Log in",
    await page.getByRole("link", { name: "Log in" }).first().isVisible(),
  );
  check(
    "anonymous: header has no Dashboard",
    (await page.getByRole("link", { name: "Dashboard" }).count()) === 0,
  );
  await context.close();
}

// ---------- 2. New buyer: header -> dashboard -> consent -> account ----------
const buyer = {
  sub: "auth0|buyer1",
  email: "buyer1@test.example",
  email_verified: true,
  name: "Asha Buyer",
};
{
  const { context, page } = await newPage(buyer);
  await page.goto(baseUrl + "/");
  await page
    .getByRole("link", { name: "My account" })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check(
    "buyer: header shows My account",
    await page.getByRole("link", { name: "My account" }).first().isVisible(),
  );
  check(
    "buyer: header shows Saved and no builder portal link",
    (await page.getByRole("link", { name: "Saved", exact: true }).count()) > 0 &&
      (await page.getByRole("link", { name: "Builder portal" }).count()) === 0,
  );
  check(
    "buyer: header shows Log out",
    await page.getByRole("link", { name: "Log out" }).first().isVisible(),
  );
  check(
    "buyer: header no longer offers Log in",
    (await page.getByRole("link", { name: "Log in" }).count()) === 0,
  );

  await page.getByRole("link", { name: "My account" }).first().click();
  await page.waitForURL(/\/welcome/, { timeout: 15000 }).catch(() => {});
  check("buyer: first visit goes to terms page", pathOf(page).startsWith("/welcome"), pathOf(page));
  check(
    "buyer: terms page keeps returnTo=/account",
    pathOf(page).includes("returnTo=%2Faccount"),
    pathOf(page),
  );

  // submit without ticking
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForTimeout(800);
  check(
    "buyer: unticked box shows an error and stays",
    (await page.getByText("Please tick the box").count()) > 0 &&
      pathOf(page).startsWith("/welcome"),
    pathOf(page),
  );

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForURL(/\/account$/, { timeout: 15000 }).catch(() => {});
  check("buyer: after accepting, lands on /account", pathOf(page) === "/account", pathOf(page));
  check(
    "buyer: account page greets by name",
    (await page.getByText("Welcome, Asha Buyer").count()) > 0,
  );

  // second visit: no consent prompt again
  await page.goto(baseUrl + "/dashboard");
  check("buyer: returning visit skips the terms page", pathOf(page) === "/account", pathOf(page));

  // wrong areas bounce back
  await page.goto(baseUrl + "/admin");
  check("buyer: /admin sends them back to /account", pathOf(page) === "/account", pathOf(page));
  await page.goto(baseUrl + "/portal");
  check("buyer: /portal sends them back to /account", pathOf(page) === "/account", pathOf(page));

  // ---------- 3. Becomes a builder ----------
  await page.getByRole("link", { name: "List your project" }).click();
  await page.waitForURL(/\/start-listing/, { timeout: 15000 }).catch(() => {});
  check(
    "builder: List your project opens /start-listing",
    pathOf(page) === "/start-listing",
    pathOf(page),
  );
  await page.getByRole("button", { name: "Create my builder account" }).click();
  await page.waitForURL(/\/portal$/, { timeout: 15000 }).catch(() => {});
  check("builder: account creation lands on /portal", pathOf(page) === "/portal", pathOf(page));
  check("builder: portal shows a DRAFT builder", (await page.getByText("DRAFT").count()) > 0);

  await page.goto(baseUrl + "/dashboard");
  check("builder: Dashboard now goes to /portal", pathOf(page) === "/portal", pathOf(page));
  await page.goto(baseUrl + "/account");
  check("builder: /account now redirects to /portal", pathOf(page) === "/portal", pathOf(page));
  await page.goto(baseUrl + "/start-listing");
  check(
    "builder: /start-listing does not create a second company",
    pathOf(page) === "/portal",
    pathOf(page),
  );
  await page.goto(baseUrl + "/admin");
  check("builder: /admin redirects to /portal", pathOf(page) === "/portal", pathOf(page));
  await context.close();
}

// ---------- 4. Admin ----------
{
  const admin = {
    sub: "auth0|admin1",
    email: "admin@test.example",
    email_verified: true,
    name: "Root Admin",
  };
  const { context, page } = await newPage(admin);
  await page.goto(baseUrl + "/dashboard");
  await page.waitForURL(/\/welcome/, { timeout: 15000 }).catch(() => {});
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 15000 }).catch(() => {});
  check("admin: Dashboard lands on /admin", pathOf(page) === "/admin", pathOf(page));
  // The builder created above is still a draft, so the Draft card on the admin home counts it.
  const draftCard = page.locator('a[href="/admin/builders?status=DRAFT"]');
  check(
    "admin: console counts the draft builder created above",
    (await draftCard.getByText("1", { exact: true }).count()) > 0,
  );
  await page.goto(baseUrl + "/portal");
  check("admin: /portal redirects to /admin", pathOf(page) === "/admin", pathOf(page));
  await page.goto(baseUrl + "/account");
  check("admin: /account redirects to /admin", pathOf(page) === "/admin", pathOf(page));
  await context.close();
}

// ---------- 5. Unverified email ----------
{
  const user = {
    sub: "auth0|unv1",
    email: "unverified@test.example",
    email_verified: false,
    name: "Una Verified",
  };
  const { context, page } = await newPage(user);
  await page.goto(baseUrl + "/");
  await page
    .getByRole("link", { name: "Verify your email" })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check(
    "unverified: header offers Verify your email",
    await page.getByRole("link", { name: "Verify your email" }).first().isVisible(),
  );
  check(
    "unverified: header does not show Dashboard",
    (await page.getByRole("link", { name: "Dashboard" }).count()) === 0,
  );
  await page.getByRole("link", { name: "Verify your email" }).first().click();
  await page.waitForURL(/account-problem/, { timeout: 10000 }).catch(() => {});
  check(
    "unverified: that link opens the verify-email page",
    pathOf(page).includes("reason=email-unverified"),
    pathOf(page),
  );
  await page.goto(baseUrl + "/dashboard");
  check(
    "unverified: /dashboard goes to the verify-email page",
    pathOf(page).startsWith("/account-problem?reason=email-unverified"),
    pathOf(page),
  );
  check(
    "unverified: page shows their email",
    (await page.getByText("unverified@test.example").count()) > 0,
  );
  check(
    "unverified: continue button is the primary action",
    (await page.getByRole("link", { name: /verified my email, continue/ }).count()) > 0,
  );
  await page.goto(baseUrl + "/portal");
  check(
    "unverified: /portal also blocked",
    pathOf(page).startsWith("/account-problem"),
    pathOf(page),
  );
  await context.close();
}

// ---------- 6. Open redirect through the terms page ----------
{
  const user = {
    sub: "auth0|redir1",
    email: "redir@test.example",
    email_verified: true,
    name: "Rita",
  };
  const { context, page } = await newPage(user);
  await page.goto(baseUrl + "/welcome?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForTimeout(1500);
  check(
    "security: malicious returnTo stays on our site",
    new URL(page.url()).origin === new URL(baseUrl).origin,
    page.url(),
  );
  await context.close();
}

// ---------- 7. Tampered cookie ----------
{
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "__session",
      value: "not-a-real-session",
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ]);
  const page = await context.newPage();
  await page.goto(baseUrl + "/portal");
  check(
    "security: forged cookie is sent to login",
    pathOf(page).startsWith("/auth/login") || page.url().includes("dummy.invalid"),
    page.url(),
  );
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
