// Lists every route handler, server action file and page, and which access check each one contains.
// A static check, not a proof: it finds a file that has NO recognised guard so a person can look at
// it. Run it after adding any route or action.
//
//   node scripts/audit-access.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src", "app");
const GUARDS = [
  "requireUser",
  "requireBuilderContext",
  "requireProjectContext",
  "getApiUser",
  "findOwnedProject",
  "checkCronAccess",
  "cronRoute",
  "verifyWebhookSignature",
  "processWebhook",
  "fromOurOwnPages",
];
// Public on purpose, each with the reason.
const PUBLIC = new Map([
  ["api/health/route.ts", "liveness probe"],
  ["api/health/db/route.ts", "database probe, no data"],
  ["api/me/route.ts", "reports only the caller's own login state"],
  ["api/plots/template/route.ts", "a blank CSV template"],
  ["api/files/[...key]/route.ts", "serves only keys under a public/ folder (isPublicKey)"],
  ["(app)/account-problem/page.tsx", "explains a sign-in problem, from a fixed list of reasons"],
  ["login-continue/route.ts", "post-login redirect, validated return path"],
  ["logout/route.ts", "clears the mode cookie and ends the session"],
  ["pwa-icon/[size]/route.tsx", "static icon"],
]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rows = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const isRoute = /(^|\/)route\.tsx?$/.test(rel);
  const source = readFileSync(file, "utf8");
  const isAction = /^\s*["']use server["']/m.test(source);
  const isPage = /(^|\/)page\.tsx$/.test(rel);
  if (!isRoute && !isAction && !isPage) continue;
  const found = GUARDS.filter((g) => source.includes(g));
  rows.push({ rel, kind: isRoute ? "route" : isAction ? "actions" : "page", found });
}

// A page is protected by its layout or its proxy path when it is under these.
const AREA_GUARDED = [/^\(app\)\/(portal|account|admin)\//, /^\(app\)\/(portal|account|admin)$/];
let unguarded = 0;
for (const row of rows) {
  const reason = PUBLIC.get(row.rel);
  const byLayout = row.kind === "page" && AREA_GUARDED.some((re) => re.test(row.rel));
  const publicPage = row.kind === "page" && row.rel.startsWith("(site)/");
  const ok = row.found.length > 0 || reason || byLayout || publicPage || row.rel.startsWith("(app)/switch");
  if (!ok) unguarded++;
  if (row.kind !== "page" || !ok) {
    console.log(
      `${ok ? "ok   " : "CHECK"} ${row.kind.padEnd(7)} ${row.rel}  ${row.found.join(", ") || (reason ? `public: ${reason}` : "")}`,
    );
  }
}
console.log(`\n${rows.length} files, ${unguarded} without a recognised guard.`);
process.exit(unguarded === 0 ? 0 : 1);
